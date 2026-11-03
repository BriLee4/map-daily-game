import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, PublicState, ServerMessage, YouState } from "../../shared/protocol";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface PartyConn {
  status: ConnStatus;
  state: PublicState | null;
  you: YouState | null;
  needName: boolean;
  error: string | null;
  /** terminal reason the socket will not reconnect (kicked, locked, ended, not found) */
  fatal: string | null;
  /** server clock minus local clock, ms */
  clockOffset: number;
  send: (m: ClientMessage) => void;
  clearError: () => void;
}

/** WebSocket connection to a Party Durable Object, with automatic reconnect. */
export function useParty(path: string | null): PartyConn {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [state, setState] = useState<PublicState | null>(null);
  const [you, setYou] = useState<YouState | null>(null);
  const [needName, setNeedName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!path) return;
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}${path}`);
      wsRef.current = ws;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage;
        switch (msg.t) {
          case "state":
            setState(msg.state);
            setYou(msg.you);
            setNeedName(false);
            setClockOffset(msg.state.serverNow - Date.now());
            break;
          case "needName":
            setNeedName(true);
            break;
          case "error":
            setError(msg.message);
            break;
          case "rejected":
            stopped = true;
            setFatal(msg.message);
            setStatus("closed");
            ws.close(1000);
            break;
          case "kicked":
            setFatal("The teacher removed you from this game.");
            break;
        }
      };
      ws.onclose = (ev) => {
        if (stopped) return;
        // 4001 kicked, 4003 locked/ended, 4000 expired; 1006 with no state yet may be a 4xx on upgrade
        if (ev.code === 4001) return setFatal((f) => f ?? "The teacher removed you from this game."), setStatus("closed");
        if (ev.code === 4003 || ev.code === 4000) return setFatal((f) => f ?? "This game is no longer open."), setStatus("closed");
        setStatus("reconnecting");
        attempt++;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempt, 5)));
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState === WebSocket.CLOSED) {
        clearTimeout(timer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close(1000);
    };
  }, [path]);

  const send = useCallback((m: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);
  const clearError = useCallback(() => setError(null), []);

  return { status, state, you, needName, error, fatal, clockOffset, send, clearError };
}

/** Seconds left on the round clock, ticking locally but anchored to server time. */
export function useCountdown(endsAt: number | null, clockOffset: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - (now + clockOffset)) / 1000));
}
