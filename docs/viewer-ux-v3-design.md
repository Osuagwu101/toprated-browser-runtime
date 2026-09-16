# Viewer UX V3 — Root Cause and Transport Decision

## Benchmark

The target is interaction quality, not visual copying of Quadratools. The reference video shows the SaaS occupying the usable browser area with ordinary typing, scrolling and navigation. The previous TRST viewer visibly exposed a remote Chrome frame inside a dark canvas and felt delayed.

## Root cause

The previous writer path requested a new JPEG screenshot over HTTP about every 250 ms, polled status separately, and POSTed pointer/keyboard/text events separately. Every writer input also refreshed page metadata through CDP. The administrator path added another cost: each frame launched ImageMagick against Xvfb and each input invoked xdotool.

This architecture created avoidable network round trips, focus fragility, low visual cadence and a viewer that could die when its original five/fifteen-minute grant expired even though the underlying browser was still healthy.

## Approaches evaluated

- **WebSocket + CDP screencast:** best fit for existing writer sessions. It reuses Chrome/CDP already isolated on localhost, streams changed frames without public CDP exposure, and supports ordered bidirectional input.
- **WebRTC:** excellent low-latency media transport, but adds ICE/STUN/TURN, media encoding and operational complexity before the current bottlenecks are proven to require it.
- **noVNC/RFB:** mature full-desktop transport and a viable fallback, but adds an RFB/VNC server per display and exposes more desktop surface than the writer needs.
- **Apache Guacamole:** strong remote-desktop gateway, but significantly heavier than the current single-browser runtime and unnecessary for the first production-quality browser viewer.
- **Browserless-style streaming:** validates the live-browser-streaming model, but TRST already owns its Chrome lifecycle and account-profile isolation.
- **DOM/reverse proxy:** rejected as the primary path because arbitrary SaaS can depend on CSP, SameSite cookies, OAuth origins, WebSockets, service workers, absolute URLs and anti-bot behavior.

## Selected V3 architecture

Writer sessions keep the existing isolated Chrome process and persistent account profile. The viewer now establishes one same-origin WebSocket. Chrome `Page.startScreencast` supplies frames and the existing CDP input methods remain server-side. Input messages are serialized so keyboard order cannot interleave, and the WebSocket hot path skips the old per-input metadata/authentication round trips. Authentication is revalidated on the connection heartbeat.

Administrator authentication preserves the existing headed Google Chrome + Xvfb design and its explicit rule that no automation/CDP is attached while the human logs in. Its frames and xdotool input are carried through the same WebSocket viewer, while post-login validation remains unchanged.

The launch URL still contains only the existing short-lived grant in its fragment. On connection, that bootstrap credential is exchanged for a random session-bound reconnect ticket. Reconnect tickets are stored only as hashes server-side, rotate on successful reconnect, are unusable for another browser session, and are revoked when the runtime session closes. Raw CDP remains bound to localhost.

## UX changes

- Full available viewer area; the permanent TRST viewer header is removed.
- Push-based frames instead of 250 ms screenshot polling.
- Pointer movement is throttled locally and sent over the persistent channel.
- Text uses `beforeinput`/composition events rather than one HTTP request per printable key.
- Paste is chunked into bounded ordered text messages.
- Ctrl/Cmd shortcuts, Tab, Shift+Tab, Enter, Escape and scrolling remain input events.
- Automated writer viewport follows the client viewport while preserving aspect ratio within the runtime maximum.
- Transient disconnects reconnect to the same live session using a rotating reconnect ticket.

## Security invariants retained

Signed OVH-to-runtime service calls, replay protection, server-side grants/capacity, account-profile isolation, no writer credentials, no public CDP endpoint, invalid viewer rejection, persistent identity protection, Browser Use rollback, and separation of Self Hosted state from Browser Use saved authentication are unchanged.

## Rollback

The change is isolated to the viewer transport and browser-worker presentation/input path. The existing HTTP frame/status/input endpoints remain available during the V3 rollout, and the production commit before this work remains the deployment rollback point. Browser Use routing is not changed.
