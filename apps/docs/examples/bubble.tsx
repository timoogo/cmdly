import { useState } from 'react';
import { CommandBubble, useCommandCombobox, useCommandSession, type Command, type CommandCombobox } from '@cmdly/react';

const commands: Command[] = [{ id: 'hello', label: 'Say hello', run: () => console.log('Hello!') }];

// Level 1: ready to use.
export const Ready = () => <CommandBubble mode="standalone" commands={commands} />;

// Level 2: custom trigger element and content, behaviour kept by the bubble.
function List({ command }: { command: CommandCombobox }) {
  const { inputProps, listboxProps, getOptionProps, visibleItems, listVisible } = command;
  return <>
    <input aria-label="Search" {...inputProps} />
    {listVisible && <ul {...listboxProps}>{visibleItems.map(({ item, index }) =>
      <li key={index} {...getOptionProps(index)}>{item.label}</li>)}</ul>}
  </>;
}
export const Custom = () => (
  <CommandBubble mode="standalone" commands={commands} trigger={props => <button {...props} className="pill">Actions</button>}>
    {command => <List command={command} />}
  </CommandBubble>
);

// Level 3: fully headless, in your own container.
function Panel({ onClose }: { onClose: () => void }) {
  const engine = useCommandSession({ commands, callbacks: { onClose } }); // stable commands, inline callbacks
  const command = useCommandCombobox(engine);
  return <section aria-label="Commands" {...command.rootProps}>
    {command.tokens.announcer && <span {...command.tokens.announcer} />}
    <List command={command} />
  </section>;
}
export function Headless() {
  const [open, setOpen] = useState(false);
  return open ? <Panel onClose={() => setOpen(false)} /> : <button onClick={() => setOpen(true)}>Commands</button>;
}
