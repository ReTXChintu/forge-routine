import {
  Box,
  HStack,
  Input,
  Kbd,
  Modal,
  ModalContent,
  ModalOverlay,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Global command palette (§37), Ctrl/Cmd+K.
 *
 * Keyboard-first is part of the design language: this is a developer tool, and
 * reaching for a mouse to start today's work is friction the product cannot
 * afford if it wants to be opened every day.
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: (navigate: ReturnType<typeof useNavigate>) => void;
}

const COMMANDS: Command[] = [
  { id: 'dashboard', label: 'Open dashboard', run: (n) => n('/') },
  { id: 'routine', label: "Start today's routine", run: (n) => n('/') },
  { id: 'technologies', label: 'Add technology', run: (n) => n('/technologies') },
  { id: 'skills', label: 'Review weak skills', hint: 'Weakest first', run: (n) => n('/skills') },
];

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsOpen((open) => !open);
        setQuery('');
        setSelected(0);
      }
      if (event.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.filter((command) => command.label.toLowerCase().includes(needle));
  }, [query]);

  const run = (command: Command) => {
    setIsOpen(false);
    command.run(navigate);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      initialFocusRef={inputRef}
      isCentered={false}
      size="lg"
    >
      <ModalOverlay bg="blackAlpha.700" />
      <ModalContent
        bg="surface.100"
        borderWidth="1px"
        borderColor="surface.400"
        borderRadius="lg"
        mt="15vh"
        overflow="hidden"
      >
        <Input
          ref={inputRef}
          placeholder="Type a command…"
          value={query}
          variant="unstyled"
          px={4}
          py={4}
          fontSize="md"
          borderBottomWidth="1px"
          borderColor="surface.300"
          borderRadius={0}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((index) => Math.min(index + 1, matches.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter') {
              const command = matches[selected];
              if (command) run(command);
            }
          }}
        />

        <VStack align="stretch" spacing={0} maxH="320px" overflowY="auto" py={2}>
          {matches.length === 0 && (
            <Text px={4} py={3} fontSize="sm" color="ink.500">
              Nothing matches.
            </Text>
          )}
          {matches.map((command, index) => (
            <HStack
              key={command.id}
              px={4}
              py={2}
              spacing={3}
              bg={index === selected ? 'surface.300' : 'transparent'}
              cursor="pointer"
              onMouseEnter={() => setSelected(index)}
              onClick={() => run(command)}
            >
              <Box
                w="2px"
                h="16px"
                bg={index === selected ? 'forge.500' : 'transparent'}
                borderRadius="full"
              />
              <Text fontSize="sm" color="ink.200" flex="1">
                {command.label}
              </Text>
              {command.hint && (
                <Text fontSize="xs" color="ink.500">
                  {command.hint}
                </Text>
              )}
            </HStack>
          ))}
        </VStack>

        <HStack
          px={4}
          py={2}
          borderTopWidth="1px"
          borderColor="surface.300"
          spacing={3}
          bg="surface.50"
        >
          <HStack spacing={1}>
            <Kbd fontSize="xs">↑</Kbd>
            <Kbd fontSize="xs">↓</Kbd>
            <Text fontSize="xs" color="ink.500">
              navigate
            </Text>
          </HStack>
          <HStack spacing={1}>
            <Kbd fontSize="xs">↵</Kbd>
            <Text fontSize="xs" color="ink.500">
              run
            </Text>
          </HStack>
        </HStack>
      </ModalContent>
    </Modal>
  );
}
