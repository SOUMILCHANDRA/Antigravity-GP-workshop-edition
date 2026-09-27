import type { TrackControlPoint } from '../track/types';

export interface HistoryCommand {
  name: string;
  undo: () => void;
  redo: () => void;
}

export class UndoManager {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private maxHistory: number = 60;
  private onStateChangeCallback?: () => void;

  constructor(onStateChange?: () => void) {
    this.onStateChangeCallback = onStateChange;
  }

  public execute(command: HistoryCommand): void {
    command.redo();
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // Clear redo stack on new command
    this.notify();
  }

  public undo(): boolean {
    if (!this.canUndo()) return false;
    const cmd = this.undoStack.pop()!;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
    return true;
  }

  public redo(): boolean {
    if (!this.canRedo()) return false;
    const cmd = this.redoStack.pop()!;
    cmd.redo();
    this.undoStack.push(cmd);
    this.notify();
    return true;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback();
    }
  }

  // Snapshot helpers
  public static clonePoints(points: TrackControlPoint[]): TrackControlPoint[] {
    return points.map(p => ({
      id: p.id,
      position: p.position.clone(),
      bankingDeg: p.bankingDeg,
      width: p.width,
      kerbLeft: p.kerbLeft,
      kerbRight: p.kerbRight,
      gravelLeftWidth: p.gravelLeftWidth,
      gravelRightWidth: p.gravelRightWidth
    }));
  }
}
