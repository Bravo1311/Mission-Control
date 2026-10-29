import { createContext, useContext, useEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react';
import { Ros, Topic } from 'roslib';
import { recordReception } from '../lib/receiveStats.js';
import { appendSample, topicPolicy } from '../lib/topicPolicy.js';
import { createTelemetryUpdates } from '../lib/telemetryUpdates.js';
import { inferPanelType } from '../lib/inferPanelType.js';

const TelemetryContext = createContext();

const EMPTY_BUFFER = { t: [], raw: [], version: 0 };
const idle = { subscribe: () => () => {}, snapshot: () => 0 };
// Metadata-only by default; visualizations explicitly choose their update cadence.
// eslint-disable-next-line react-refresh/only-export-components
export const useTelemetry = (period = 0) => {
    const context = useContext(TelemetryContext);
    const channel = period ? context.updates.channel(period) : idle;
    useSyncExternalStore(channel.subscribe, channel.snapshot, channel.snapshot);
    return context;
};

export const TelemetryProvider = ({ children }) => {
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
    const subs = useRef({});
    const buffers = useRef({});
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
        if (status !== 'connected' || !rosRef.current) return;
        selected.forEach(({ name, type }) => {
            const policy = topicPolicy(type);
            const sensor = ['camera', 'lidar'].includes(policy.kind);
            const compression = sensor ? sensorTransport : 'none';
            // Retain a low-rate latest frame for sources not being displayed.
            const throttle = sensor && !activePreviews.current.has(name) ? 1000 : policy.throttle;
            if (subs.current[name]?.compression === compression && subs.current[name]?.throttle_rate === throttle) return;
            subs.current[name]?.unsubscribe();
            const topic = new Topic({ ros: rosRef.current, name, messageType: type, compression, throttle_rate: throttle, queue_length: 1, reconnect_on_close: false });
            subs.current[name] = topic;
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
                appendSample(buf, msg, relT(), classifications.current[name]);
            });
            subs.current[name] = topic;
        });
    }, [selected, status, relT, updates, sensorTransport, previewRevision]);

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
        updates,
        sensorTransport,
        setSensorTransport,
        registerPreview,
        status,
        connect,
        disconnect,
        available,
        selected,
        addTopic,
        removeTopic,
        clearAll,
        classify: (name) => classifications.current[name] || inferPanelType(selected.find(t => t.name === name)?.type),
        getBuffer: (name) => buffers.current[name] || EMPTY_BUFFER,
    };

    return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
};