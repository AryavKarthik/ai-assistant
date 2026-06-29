import { useEffect, useState } from "react";
import { nova } from "./lib/ipc";

export function App() {
  const [reply, setReply] = useState("…");
  useEffect(() => { nova().ping().then(setReply); }, []);
  return <div style={{ color: "white", padding: 16 }}>Nova: {reply}</div>;
}
