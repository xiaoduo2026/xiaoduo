/*
 * 联机封装：PeerJS 信令 + WebRTC 数据通道。
 * 邀请码就是 PeerJS 的 peer id，例如 q9-a1b2c3。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.QuoridorOnline = factory(root);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.qq.com:3478" },
    { urls: "stun:stun.miwifi.com:3478" },
    {
      urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
      username: "peerjs",
      credential: "peerjsp",
    },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ];

  function randomCode(length) {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    let out = "";
    const cryptoObj = root.crypto;
    if (cryptoObj && cryptoObj.getRandomValues) {
      const bytes = new Uint8Array(length);
      cryptoObj.getRandomValues(bytes);
      for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
      return out;
    }
    for (let i = 0; i < length; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function peerErrorMessage(error) {
    const type = error && error.type ? error.type : "";
    switch (type) {
      case "peer-unavailable":
        return "邀请码不存在，或对方已经离开";
      case "network":
      case "server-error":
      case "socket-error":
      case "socket-closed":
        return "无法连接联机服务器，请检查网络后重试";
      case "unavailable-id":
        return "邀请码冲突，请重新创建";
      case "browser-incompatible":
        return "当前浏览器不支持联机，请换用新版 Edge / Chrome / Safari";
      case "webrtc":
        return "点对点连接失败，双方网络可能受限，可换手机热点再试";
      default:
        return (error && error.message) || "联机发生错误";
    }
  }

  class OnlineSession {
    constructor(options) {
      options = options || {};
      this.PeerCtor =
        options.Peer ||
        (typeof Peer !== "undefined" ? Peer : null) ||
        (root && root.Peer) ||
        null;
      this.onOpen = options.onOpen || function () {};
      this.onMessage = options.onMessage || function () {};
      this.onClose = options.onClose || function () {};
      this.onStatus = options.onStatus || function () {};
      this.peer = null;
      this.conn = null;
      this.code = "";
      this.isHost = false;
      this.closed = false;
      this._joinResolve = null;
      this._joinReject = null;
      this._joinTimer = null;
    }

    available() {
      return !!this.PeerCtor;
    }

    _peerOptions() {
      return {
        debug: 0,
        host: "0.peerjs.com",
        port: 443,
        secure: true,
        path: "/",
        config: { iceServers: ICE_SERVERS },
      };
    }

    host() {
      return new Promise((resolve, reject) => {
        if (!this.PeerCtor) {
          reject(new Error("联机组件加载失败"));
          return;
        }
        this.close();
        this.closed = false;
        this.isHost = true;
        const code = "q9-" + randomCode(6);
        this.onStatus({ type: "connecting", text: "正在创建邀请码…" });

        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          reject(new Error(peerErrorMessage(error)));
        };

        try {
          const peer = new this.PeerCtor(code, this._peerOptions());
          this.peer = peer;

          peer.on("open", (id) => {
            if (this.closed) return;
            this.code = id;
            settled = true;
            this.onStatus({ type: "waiting", code: id });
            resolve(id);
          });

          peer.on("connection", (conn) => {
            if (this.conn) {
              try {
                conn.close();
              } catch (error) {
                // 忽略第二个连接
              }
              return;
            }
            this._attach(conn);
          });

          peer.on("error", (error) => {
            this.onStatus({ type: "error", text: peerErrorMessage(error) });
            fail(error);
          });

          peer.on("disconnected", () => {
            this.onStatus({ type: "signal-lost", text: "信令连接断开，正在重连…" });
            try {
              peer.reconnect();
            } catch (error) {
              // 忽略
            }
          });

          setTimeout(() => {
            if (!settled) fail(new Error("创建邀请码超时，请检查网络"));
          }, 20000);
        } catch (error) {
          reject(new Error(peerErrorMessage(error)));
        }
      });
    }

    join(code) {
      code = String(code || "").trim();
      return new Promise((resolve, reject) => {
        if (!this.PeerCtor) {
          reject(new Error("联机组件加载失败"));
          return;
        }
        if (!code) {
          reject(new Error("请先填写邀请码"));
          return;
        }
        this.close();
        this.closed = false;
        this.isHost = false;
        this.onStatus({ type: "connecting", text: "正在加入房间…" });

        this._joinResolve = resolve;
        this._joinReject = reject;
        this._joinTimer = setTimeout(() => {
          if (this._joinReject) {
            const rejectFn = this._joinReject;
            this._joinResolve = null;
            this._joinReject = null;
            rejectFn(new Error("加入超时，请确认邀请码是否正确"));
          }
        }, 20000);

        try {
          const peer = new this.PeerCtor(undefined, this._peerOptions());
          this.peer = peer;

          peer.on("open", () => {
            if (this.closed) return;
            const conn = peer.connect(code, {
              reliable: true,
              serialization: "json",
            });
            this._attach(conn);
          });

          peer.on("error", (error) => {
            const message = peerErrorMessage(error);
            this.onStatus({ type: "error", text: message });
            if (this._joinReject) {
              const rejectFn = this._joinReject;
              this._joinResolve = null;
              this._joinReject = null;
              clearTimeout(this._joinTimer);
              rejectFn(new Error(message));
            }
          });
        } catch (error) {
          reject(new Error(peerErrorMessage(error)));
        }
      });
    }

    _attach(conn) {
      this.conn = conn;
      const openHandler = () => {
        if (this.closed) return;
        this.onStatus({ type: "connected", text: "已连接" });
        if (this._joinResolve) {
          const resolveFn = this._joinResolve;
          this._joinResolve = null;
          this._joinReject = null;
          clearTimeout(this._joinTimer);
          resolveFn();
        }
        this.onOpen(conn);
      };

      if (conn.open) openHandler();
      else conn.on("open", openHandler);

      conn.on("data", (data) => {
        if (this.closed) return;
        this.onMessage(data);
      });
      conn.on("close", () => {
        if (this.closed) return;
        this.conn = null;
        this.onStatus({ type: "closed", text: "连接已断开" });
        this.onClose();
      });
      conn.on("error", (error) => {
        this.onStatus({ type: "error", text: peerErrorMessage(error) });
      });
    }

    send(message) {
      if (this.conn && this.conn.open) {
        try {
          this.conn.send(message);
          return true;
        } catch (error) {
          return false;
        }
      }
      return false;
    }

    close() {
      this.closed = true;
      if (this._joinReject) {
        const rejectFn = this._joinReject;
        this._joinResolve = null;
        this._joinReject = null;
        clearTimeout(this._joinTimer);
        rejectFn(new Error("已取消"));
      }
      if (this.conn) {
        try {
          this.conn.close();
        } catch (error) {
          // 忽略
        }
        this.conn = null;
      }
      if (this.peer) {
        try {
          this.peer.destroy();
        } catch (error) {
          // 忽略
        }
        this.peer = null;
      }
    }
  }

  return { OnlineSession, ICE_SERVERS, peerErrorMessage };
});
