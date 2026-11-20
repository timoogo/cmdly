import { useEffect, useRef, useState } from 'react';
import { CommandBubble, createCommandEngine, type Command, type CommandBubbleHandle } from '@cmdly/react';

const commands: Command[] = [{ id: 'hello', label: 'Say hello', run: () => console.log('Hello!') }];

// Trigger mode (default): a floating button opening the modal palette; uncontrolled, with a ref.
export function Trigger() {
  const bubble = useRef<CommandBubbleHandle>(null); // open(), close(), toggle()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); bubble.current?.toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <CommandBubble ref={bubble} commands={commands} placement="bottom-right" trigger={<span aria-hidden="true">⌘</span>} />;
}

// Standalone mode: a non-modal popover next to an inline trigger; controlled.
export function Standalone() {
  const [open, setOpen] = useState(false);
  return <CommandBubble mode="standalone" layout="inline" commands={commands} open={open} onOpenChange={setOpen} label="Actions" />;
}

// External engine: one session you own, kept across openings and shared with other interfaces.
const shared = createCommandEngine({ commands });
export const Shared = () => <CommandBubble mode="standalone" engine={shared} />;
