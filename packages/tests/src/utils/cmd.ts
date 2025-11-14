import type { Cmd, Msg } from '@bubbletea/tea';

/** Executes a command and returns its message (awaiting promises if necessary). */
export const runCmd = async <TMsg = Msg>(cmd: Cmd<TMsg>): Promise<TMsg | undefined | null> => {
  if (!cmd) {
    return undefined;
  }

  return await cmd();
};
