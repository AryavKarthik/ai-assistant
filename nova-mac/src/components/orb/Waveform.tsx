export function Waveform({ level }: { level: number }) {
  const bars = 5;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", height: 40 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const center = 1 - Math.abs(i - (bars - 1) / 2) / bars;
        const h = 6 + Math.min(1, level * 2) * center * 30;
        return (
          <div key={i} style={{
            width: 4, height: h, borderRadius: 2,
            background: "rgba(255,255,255,0.9)", transition: "height 80ms linear",
          }} />
        );
      })}
    </div>
  );
}
