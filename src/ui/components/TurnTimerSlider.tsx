const STOPS = [30, 45, 60];

interface TurnTimerSliderProps {
  seconds: number;
  disabled?: boolean;
  onChange: (seconds: number) => void;
}

/** How long a Speed turn lasts. */
export function TurnTimerSlider({ seconds, disabled = false, onChange }: TurnTimerSliderProps) {
  return (
    <div className="turn-timer-slider">
      <label>
        <span>Seconds per turn: <strong>{seconds}</strong></span>
        <input
          type="range"
          min={STOPS[0]}
          max={STOPS[STOPS.length - 1]}
          step={15}
          list="turn-timer-stops"
          value={seconds}
          disabled={disabled}
          aria-valuetext={`${seconds} seconds`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
      <datalist id="turn-timer-stops">
        {STOPS.map((stop) => <option key={stop} value={stop} />)}
      </datalist>
      <div className="turn-timer-stops" aria-hidden="true">
        {STOPS.map((stop) => <span key={stop} className={stop === seconds ? 'is-chosen' : ''}>{stop}</span>)}
      </div>
    </div>
  );
}
