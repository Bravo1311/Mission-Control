import { createContext, useContext, useEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react';
import { Ros, Topic } from 'roslib';
import { recordReception } from '../lib/receiveStats.js';
import { appendSample, topicPolicy, trimHistory, sensorPayloadBytes, sensorThrottle } from '../lib/topicPolicy.js';
import { performanceProfile, loadPerformancePreference, validPerformancePreference, PERFORMANCE_STORAGE_KEY, MOBILE_QUERY } from '../lib/performanceProfile.js';
import { defaultBridgeUrl } from '../lib/connectionConfig.js';
import { createTelemetryUpdates } from '../lib/telemetryUpdates.js';
import { inferPanelType } from '../lib/inferPanelType.js';

const TelemetryContext = createContext();

const EMPTY_BUFFER = { t: [], raw: [], version: 0 };
const idle = { subscribe: () => () => {}, snapshot: () => 0 };
// Metadata-only by default; visualizations explicitly choose their update cadence.
// eslint-disable-next-line react-refresh/only-export-components
export const useTelemetry = (period = 0) => {
    const context = useContext(TelemetryContext);
    const channel = period ? context.updates.channel(Math.max(period, context.performance.instrumentMs)) : idle;
    useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot);
    return context;
};

export const TelemetryProvider = ({ children, bridgeUrl = defaultBridgeUrl(window.location) }) => {
    const [performancePreference, setPreference] = useState(() => {
        try { return loadPerformancePreference(window.localStorage); } catch { return 'auto'; }
    });
    const [mobileDevice, setMobileDevice] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
    useEffect(() => {
        const query = window.matchMedia(MOBILE_QUERY);
        const change = () => setMobileDevice(query.matches);
        query.addEventListener('change', change);
        return () => query.removeEventListener('change', change);
    }, []);
    const performanceMode = performancePreference === 'auto' ? (mobileDevice ? 'mobile' : 'desktop') : performancePreference;
    const profile = performanceProfile(performanceMode);
    const setPerformancePreference = value => {
        if (!validPerformancePreference(value)) return;
        setPreference(value);
        try { localStorage.setItem(PERFORMANCE_STORAGE_KEY, value); } catch { /* session only */ }
    };
    const [status, setStatus] = useState('disconnected');
    const [selected, setSelected] = useState([]);
    const [available, setAvailable] = useState([]);
    const [sensorTransport, setSensorTransport] = useState('cbor');
    const activePreviews = useRef(new Set());
    const [previewRevision, setPreviewRevision] = useState(0);
    const registerPreview = useCallback(name => {
        activePreviews.current.add(name);
        setPreviewRevision(n => n + 1);
        return () => {
            activePreviews.current.delete(name);
            setPreviewRevision(n => n + 1);
        };
    }, []);
    const rosRef = useRef(null);
    const [previewConnection, setPreviewConnection] = useState(false);
    const subs = useRef({});
    const subscriptionProfiles = useRef({});
    const payloadSizes = useRef({});
    const buffers = useRef({});
    const getBuffer = useCallback(name => buffers.current[name] || EMPTY_BUFFER, []);
    const classifications = useRef({});
    const t0 = useRef(null);
    const [, tick] = useState(0);
    const [updates] = useState(createTelemetryUpdates);

    const relT = useCallback(() => {
        const now = performance.now() / 1000;
        if (t0.current === null) t0.current = now;
        return now - t0.current;
    }, []);

    const connect = (url) => {
        disconnect();
        try {
            const target = new URL(url);
            setPreviewConnection(target.host === window.location.host && target.pathname === '/rosbridge/preview');
        } catch { setPreviewConnection(false); }
        payloadSizes.current = {};
        setStatus('connecting');
        const ros = new Ros({ url });
        ros.on('connection', () => {
            if (rosRef.current !== ros) return;
            setStatus('connected');
            ros.getTopics(
                (res) => {
                    if (rosRef.current !== ros) return;
                    const topics = res.topics.map((name, i) => ({ name, type: res.types[i] }));
                    setAvailable(topics.sort((a, b) => a.name.localeCompare(b.name)));
                },
                (err) => console.warn('Topic discovery failed — is the rosapi node running?', err)
            );
        });
        ros.on('error', () => { if (rosRef.current === ros) setStatus('error'); });
        ros.on('close', () => { if (rosRef.current === ros) {
            Object.values(subs.current).forEach(topic => topic.unsubscribe());
            subs.current = {};
            setStatus('disconnected');
        } });
        rosRef.current = ros;
    };

    const disconnect = () => {
        Object.values(subs.current).forEach((t) => t.unsubscribe());
        subs.current = {};
        const previous = rosRef.current;
        rosRef.current = null;
        previous?.close();
        setStatus('disconnected');
    };

    const addTopic = (name, type) => {
        if (!name || !type) return;
        setSelected((prev) => prev.some((s) => s.name === name) ? prev : [...prev, { name, type }]);
    };

    const removeTopic = (name) => {
        subs.current[name]?.unsubscribe();
        delete subs.current[name];
        delete subscriptionProfiles.current[name];
        delete payloadSizes.current[name];
        delete buffers.current[name];
        delete classifications.current[name];
        setSelected((prev) => prev.filter((s) => s.name !== name));
    };

    const clearAll = () => {
        Object.keys(buffers.current).forEach((name) => {
            buffers.current[name] = { t: [], raw: [] };
        });
        updates.mark();
        t0.current = null; // next message restarts the relative time axis from 0
    };

    useEffect(() => {
        if (status !== 'connected' || !previewConnection || !rosRef.current) return;
        payloadSizes.current = {};
        rosRef.current.callOnConnection({ op: 'mission_control_preview', profile: performanceMode });
    }, [status, performanceMode, previewConnection]);

    useEffect(() => {
        if (status !== 'connected' || !rosRef.current) return;
        const activeSensors = selected.filter(({ name, type }) => ['camera', 'lidar'].includes(topicPolicy(type).kind) && activePreviews.current.has(name)).length;
        selected.forEach(({ name, type }) => {
            const policy = topicPolicy(type, performanceMode);
            const sensor = ['camera', 'lidar'].includes(policy.kind);
            const compression = sensor ? sensorTransport : 'none';
            const throttle = sensor ? sensorThrottle(type, performanceMode, activePreviews.current.has(name), payloadSizes.current[name], activeSensors) : policy.throttle;
            if (throttle === null) {
                subs.current[name]?.unsubscribe();
                delete subs.current[name];
                delete subscriptionProfiles.current[name];
                return;
            }
            if (subs.current[name]?.compression === compression && subs.current[name]?.throttle_rate === throttle && subscriptionProfiles.current[name] === performanceMode) return;
            subs.current[name]?.unsubscribe();
            const topic = new Topic({ ros: rosRef.current, name, messageType: type, compression, throttle_rate: throttle, queue_length: 1, reconnect_on_close: false });
            subs.current[name] = topic;
            subscriptionProfiles.current[name] = performanceMode;
            topic.subscribe((msg) => {
                if (subs.current[name] !== topic) return;
                updates.mark();
                if (!classifications.current[name]) {
                    classifications.current[name] = inferPanelType(type, msg);
                    tick(n => n + 1);
                }
                if (!buffers.current[name]) buffers.current[name] = { t: [], raw: [] };
                const buf = buffers.current[name];
                recordReception(buf, msg, performance.now());
                appendSample(buf, msg, relT(), classifications.current[name], performanceMode);
                if (sensor) {
                    const size = sensorPayloadBytes(msg, compression);
                    if (size > (payloadSizes.current[name] || 0)) {
                        payloadSizes.current[name] = size;
                        if (performanceMode === 'mobile') setPreviewRevision(n => n + 1);
                    }
                }
            });
            subs.current[name] = topic;
        });
    }, [selected, status, relT, updates, sensorTransport, previewRevision, performanceMode]);

    useEffect(() => {
        Object.entries(buffers.current).forEach(([name, buffer]) => {
            const kind = classifications.current[name];
            if (['trajectory', 'geo', 'scalar'].includes(kind)) trimHistory(buffer, buffer.t.at(-1) ?? 0, kind, performanceMode);
        });
        updates.mark();
    }, [performanceMode, updates]);

    useEffect(() => {
        const id = setInterval(() => {
            if (!document.hidden) updates.flush(performance.now());
        }, 50);
        return () => clearInterval(id);
    }, [updates]);

    useEffect(() => () => {
        Object.values(subs.current).forEach((topic) => topic.unsubscribe());
        subs.current = {};
        const previous = rosRef.current;
        rosRef.current = null;
        previous?.close();
    }, []);

    const value = {
        bridgeUrl,
        performance: profile,
        hostCameraPreview: status === 'connected' && previewConnection && performanceMode === 'mobile',
        performancePreference,
        setPerformancePreference,
        updates,
        sensorTransport,
        setSensorTransport,
        registerPreview,
        requestedSensorInterval: (name, type) => sensorThrottle(type, performanceMode, true, payloadSizes.current[name], Math.max(1, activePreviews.current.size)),
        status,
        connect,
        disconnect,
        available,
        selected,
        addTopic,
        removeTopic,
        clearAll,
        classify: (name) => classifications.current[name] || inferPanelType(selected.find(t => t.name === name)?.type),
        getBuffer,
    };

    return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
};
