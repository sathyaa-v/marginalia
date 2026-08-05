// webrtc.js — same-network sharing (spec §3.9, §6.3).
//
// Two signaling paths, both landing on the same DataChannel transport:
//   - "peerjs": PeerJS Cloud handles the handshake. A short-lived peer ID
//     and SDP touch PeerJS's server; NOTE CONTENT never does — it flows
//     directly between the two browsers once connected.
//   - "manual": raw RTCPeerConnection, SDP exchanged out-of-band by the
//     user (copy/paste or QR). Nothing touches any third-party server,
//     ever — the tradeoff is a clunkier connect flow.
//
// v1 is read-only: the joining device receives a snapshot and displays
// it, but never writes it into its own IndexedDB automatically, and never
// sends edits back. Collaborative/write mode is explicitly out of scope
// (FR-47).

export class ShareSession {
  constructor({ mode = 'peerjs' } = {}) {
    this.mode = mode;
    this.peer = null;
    this.conn = null;
    this.pc = null;
    this.dc = null;
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onSnapshotReceived = null;
    this.onError = null;
  }

  isConnected() {
    return !!(this.conn?.open || (this.dc && this.dc.readyState === 'open'));
  }

  // ---------------------------------------------------------------
  // PeerJS Cloud path
  // ---------------------------------------------------------------
  async host() {
    if (typeof Peer === 'undefined') {
      throw new Error('PeerJS failed to load. Check your connection, or use Offline mode instead.');
    }
    return new Promise((resolve, reject) => {
      this.peer = new Peer(); // random short ID assigned by PeerJS Cloud
      const timeout = setTimeout(() => reject(new Error('Timed out reaching the signaling server.')), 10000);
      this.peer.on('open', (id) => { clearTimeout(timeout); resolve(id); });
      this.peer.on('error', (err) => { clearTimeout(timeout); this.onError?.(err); reject(err); });
      this.peer.on('connection', (conn) => {
        this.conn = conn;
        conn.on('open', () => this.onPeerConnected?.());
        conn.on('close', () => this.onPeerDisconnected?.());
        conn.on('error', (err) => this.onError?.(err));
      });
    });
  }

  async join(sessionCode) {
    if (typeof Peer === 'undefined') {
      throw new Error('PeerJS failed to load. Check your connection, or use Offline mode instead.');
    }
    return new Promise((resolve, reject) => {
      this.peer = new Peer();
      const timeout = setTimeout(() => reject(new Error('Timed out connecting.')), 10000);
      this.peer.on('open', () => {
        this.conn = this.peer.connect(sessionCode.trim(), { reliable: true });
        this.conn.on('open', () => { clearTimeout(timeout); this.onPeerConnected?.(); resolve(); });
        this.conn.on('data', (data) => {
          if (data && data.type === 'snapshot') this.onSnapshotReceived?.(data);
        });
        this.conn.on('close', () => this.onPeerDisconnected?.());
        this.conn.on('error', (err) => { clearTimeout(timeout); reject(err); });
      });
      this.peer.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  sendSnapshot(notes, folders) {
    const payload = { type: 'snapshot', notes, folders, sentAt: new Date().toISOString() };
    if (this.conn?.open) this.conn.send(payload);
    else if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(payload));
  }

  // ---------------------------------------------------------------
  // Manual SDP path (fully offline — no signaling server at all)
  // ---------------------------------------------------------------
  async hostManual() {
    this.pc = new RTCPeerConnection({ iceServers: [] }); // LAN-only: no STUN/TURN needed or wanted here
    this.dc = this.pc.createDataChannel('marginalia');
    this._wireManualChannel(this.dc);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return this._waitForIceGatheringComplete();
  }

  async completeManualHost(remoteAnswerJSON) {
    await this.pc.setRemoteDescription(JSON.parse(remoteAnswerJSON));
  }

  async joinManual(remoteOfferJSON) {
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.pc.ondatachannel = (e) => this._wireManualChannel(e.channel);
    await this.pc.setRemoteDescription(JSON.parse(remoteOfferJSON));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this._waitForIceGatheringComplete();
  }

  _waitForIceGatheringComplete() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve(JSON.stringify(this.pc.localDescription));
        return;
      }
      this.pc.onicegatheringstatechange = () => {
        if (this.pc.iceGatheringState === 'complete') {
          resolve(JSON.stringify(this.pc.localDescription));
        }
      };
    });
  }

  _wireManualChannel(channel) {
    this.dc = channel;
    channel.onopen = () => this.onPeerConnected?.();
    channel.onclose = () => this.onPeerDisconnected?.();
    channel.onerror = (err) => this.onError?.(err);
    channel.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'snapshot') this.onSnapshotReceived?.(data);
      } catch { /* ignore malformed payloads */ }
    };
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------
  close() {
    try { this.conn?.close(); } catch {}
    try { this.peer?.destroy(); } catch {}
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.conn = this.peer = this.dc = this.pc = null;
  }
}
