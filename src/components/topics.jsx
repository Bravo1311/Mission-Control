import { useState } from "react";
import {
    Offcanvas, OffcanvasHeader, OffcanvasBody,
    Button,
    Input,
    Row, Container, Col, InputGroup,
    ListGroup, ListGroupItem,
} from "reactstrap"
import '../assets/connection.css'
import { useTelemetry } from "../context/telemetryContext";
import { inferPanelType, PANEL_LABEL } from "../lib/inferPanelType.js";
import { useNightMode } from "../lib/useNightMode.js";

const STATUS_LABEL = {
    connected: 'Connected',
    connecting: 'Connecting…',
    disconnected: 'Disconnected',
    error: 'Connection error',
};

const Topics = () => {
    const [isOpen, setIsOpen] = useState(false)
    const tele = useTelemetry(isOpen ? 500 : 0)
    const [night, toggleNight] = useNightMode()
    const [url, setUrl] = useState(tele.bridgeUrl);
    const toggle = () => setIsOpen(!isOpen)
    const [query, setQuery] = useState('')

    const q = query.toLowerCase()
    const visible = tele.available.filter(t =>
        t.name.toLowerCase().includes(q) || t.type.toLowerCase().includes(q)
    )

    const isSelected = (name) => tele.selected?.some((s) => s.name === name)

    const selectAllVisible = () => {
        visible.forEach((e) => { if (!isSelected(e.name)) tele.addTopic(e.name, e.type) })
    }
    const deselectAllVisible = () => {
        visible.forEach((e) => { if (isSelected(e.name)) tele.removeTopic(e.name) })
    }

    const statusClass = tele.status === 'connected' ? 'success'
        : tele.status === 'connecting' ? 'warning'
            : 'danger'

    return (
        <header className="app-header">
            <div className="brand">
                <span className="brand-mark" />
                <div>
                    <div className="brand-title">Mission Control</div>
                    <div className="brand-subtitle mono">ROS 2 / Operations console</div>
                </div>
            </div>

            <div className={`status-pill status-${statusClass}`}>
                <span className="status-dot" />
                {STATUS_LABEL[tele.status] || tele.status}
            </div>

            <div className="header-actions">
                <Button
                    className={`btn-ghost night-toggle${night ? ' is-on' : ''}`}
                    size="sm"
                    aria-pressed={night}
                    title="Night panel: everything goes dark except the flight instruments, and a panel relights only when it needs attention"
                    onClick={toggleNight}
                >
                    Night
                </Button>
                <Button className="btn-ghost" size="sm" onClick={tele.clearAll}>
                    Clear
                </Button>
                <Button className="btn-primary" size="sm" onClick={toggle}>
                    Topics
                    {tele.selected.length > 0 && <span className="count-badge">{tele.selected.length}</span>}
                </Button>
            </div>

            <Offcanvas isOpen={isOpen} toggle={toggle} direction="start" className="mc-offcanvas">
                <OffcanvasHeader toggle={toggle}>Connection & topics</OffcanvasHeader>
                <OffcanvasBody>
                    <Container fluid className="px-0">
                        <Row className="mb-2 align-items-center">
                            <Col xs="auto" className="text-dim">Status</Col>
                            <Col>
                                <span className={`status-pill status-${statusClass}`}>
                                    <span className="status-dot" />
                                    {STATUS_LABEL[tele.status] || tele.status}
                                </span>
                            </Col>
                        </Row>
                        <label className="performance-setting" htmlFor="performance-mode">
                            Performance
                            <select id="performance-mode" className="panel-select" value={tele.performancePreference} onChange={event => tele.setPerformancePreference(event.target.value)}>
                                <option value="auto">Auto ({tele.performance.mode})</option>
                                <option value="mobile">Mobile · reduced load</option>
                                <option value="desktop">Desktop · full preview</option>
                            </select>
                        </label>
                        <p className="performance-description">{tele.performance.mode === 'mobile'
                            ? '640 × 360 camera · up to 10 FPS · 3,000 lidar points · 60 s history. A shared 2 MiB/s sensor budget slows large frames. Hidden sensor sources stop streaming.'
                            : '1280 × 720 camera · 20 FPS · 12,000 lidar points · 120 s history.'}</p>
                        <div className="d-flex gap-2 mb-2">
                            <Input
                                value={url}
                                bsSize="sm"
                                aria-label="Rosbridge WebSocket address"
                                autoComplete="off"
                                className="mc-input"
                                onChange={e => setUrl(e.target.value)}
                            />
                            <Button
                                className="btn-primary flex-shrink-0"
                                size="sm"
                                onClick={() => tele.connect(url)}
                            >
                                Connect
                            </Button>
                        </div>
                        <Input
                            type="search"
                            aria-label="Filter topics"
                            placeholder="Filter topics..."
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value)
                            }}
                            autoComplete="off"
                            bsSize="sm"
                            className="mc-input mb-2"
                        />
                        {tele.available.length > 0 && (
                            <div className="d-flex gap-3 mb-2 topic-bulk-actions">
                                <button type="button" onClick={selectAllVisible}>Select all</button>
                                <button type="button" onClick={deselectAllVisible}>Deselect all</button>
                                <span className="topic-bulk-count mono">{tele.selected.length} selected</span>
                            </div>
                        )}
                        <ListGroup flush className="listGroup">
                            {tele.available.length === 0 ? (
                                <div className="emptyState">No topics to display</div>
                            ) : visible.length === 0 ? (
                                <div className="emptyState">No topics match "{query}"</div>
                            ) : (
                                visible.map((e) => {
                                    const panelType = inferPanelType(e.type)
                                    const checked = isSelected(e.name)
                                    const count = tele.getBuffer(e.name)?.raw.length
                                    return (
                                        <ListGroupItem key={e.name} className={`topic-row ${checked ? 'topic-row-active' : ''}`}>
                                            <Row className="align-items-center g-2">
                                                <Col xs="auto">
                                                    <InputGroup>
                                                        <Input
                                                            addon
                                                            aria-label={`Toggle ${e.name}`}
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(c) => {
                                                                c.target.checked ? tele.addTopic(e.name, e.type) :
                                                                    tele.removeTopic(e.name)
                                                            }}
                                                        />
                                                    </InputGroup>
                                                </Col>
                                                <Col>
                                                    <div className="topic-name">{e.name}</div>
                                                    <div className="topic-type mono">{e.type}</div>
                                                </Col>
                                                <Col xs="auto" className="text-end">
                                                    <span className={`panel-type-badge panel-type-${panelType}`}>
                                                        {PANEL_LABEL[panelType]}
                                                    </span>
                                                    {checked && count > 0 && (
                                                        <div className="topic-count mono">{count} msgs</div>
                                                    )}
                                                </Col>
                                            </Row>
                                        </ListGroupItem>
                                    )
                                }))}
                        </ListGroup>
                    </Container>
                </OffcanvasBody>
            </Offcanvas>
        </header>
    )
}

export default Topics
