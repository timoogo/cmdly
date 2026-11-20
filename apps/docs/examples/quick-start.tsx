import { useState } from 'react';
import { CommandPalette } from '@cmdly/react';
import type { Command } from '@cmdly/core';

const commands: Command[] = [{ id: 'hello', label: 'Say hello', run: () => alert('Hello!') }];

export function App() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open commands</button>
    <CommandPalette commands={commands} open={open} onOpenChange={setOpen} />
  </>;
}
