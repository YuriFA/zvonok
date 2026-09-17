/**
 * Pre-join card of the embedded room: name input and mic/camera confirmation
 * before the join. Pure preset markup over consumer-supplied state.
 */

export interface PreJoinCardProps {
  showNameInput: boolean;
  name: string;
  micOn: boolean;
  cameraOn: boolean;
  onNameChange: (name: string) => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onJoin: () => void;
}

export function PreJoinCard({
  showNameInput,
  name,
  micOn,
  cameraOn,
  onNameChange,
  onToggleMic,
  onToggleCamera,
  onJoin,
}: PreJoinCardProps) {
  return (
    <div className="zk zk-room zk-prejoin">
      <form
        className="zk-card"
        onSubmit={(event) => {
          event.preventDefault();
          onJoin();
        }}
      >
        <h1 className="zk-title">Join room</h1>
        {showNameInput && (
          <label className="zk-field">
            <span>Display name</span>
            <input
              className="zk-input"
              name="displayName"
              placeholder="Your name"
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </label>
        )}
        <div className="zk-toggle-row">
          <button
            type="button"
            className={micOn ? "zk-button" : "zk-button zk-button-off"}
            aria-pressed={micOn}
            onClick={onToggleMic}
          >
            Mic
          </button>
          <button
            type="button"
            className={cameraOn ? "zk-button" : "zk-button zk-button-off"}
            aria-pressed={cameraOn}
            onClick={onToggleCamera}
          >
            Camera
          </button>
        </div>
        <button type="submit" className="zk-button zk-button-join">
          Join
        </button>
      </form>
    </div>
  );
}
