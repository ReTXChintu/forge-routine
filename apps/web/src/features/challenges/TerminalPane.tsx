import { Box, Button, HStack, Text, VStack } from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { FiCheck, FiX } from 'react-icons/fi';

import {
  useRunTerminal,
  useSubmitTerminal,
  type ChallengeView,
  type TerminalRunResult,
} from '~/lib/queries';

/**
 * A terminal against the simulated shell.
 *
 * The shell has no state on the server: every keystroke session is replayed
 * from the start against a fresh filesystem. That sounds wasteful and is not
 * — the whole filesystem is a Map, and it buys a shell that survives a
 * refresh, a second tab, and a server restart mid-exercise.
 *
 * Running is free and records nothing. Only "check my work" grades. A
 * terminal you are afraid to explore teaches you to plan in your head and
 * paste one answer, which is the opposite of learning to use a shell.
 */
export function TerminalPane({ challenge }: { challenge: ChallengeView }) {
  const [commands, setCommands] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [result, setResult] = useState<TerminalRunResult | null>(null);
  const [graded, setGraded] = useState<TerminalRunResult | null>(null);

  const run = useRunTerminal();
  const submit = useSubmitTerminal();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [result?.transcript.length]);

  const send = async () => {
    const line = input.trim();
    if (line === '') return;

    const next = [...commands, line];
    setCommands(next);
    setInput('');
    setHistoryIndex(null);

    const outcome = await run.mutateAsync({
      exerciseId: challenge.exerciseId,
      commands: next,
    });
    setResult(outcome);
  };

  const check = async () => {
    if (!challenge.attemptId) return;
    const outcome = await submit.mutateAsync({
      exerciseId: challenge.exerciseId,
      attemptId: challenge.attemptId,
      commands,
    });
    setGraded(outcome);
  };

  /** Up and down walk the history, as a real terminal does. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      void send();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = historyIndex === null ? commands.length - 1 : Math.max(0, historyIndex - 1);
      if (commands[next] !== undefined) {
        setHistoryIndex(next);
        setInput(commands[next]);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex === null) return;
      const next = historyIndex + 1;
      if (next >= commands.length) {
        setHistoryIndex(null);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(commands[next] ?? '');
      }
    }
  };

  const live = graded ?? result;

  return (
    <VStack align="stretch" spacing={4} h="100%" minH={0}>
      <Box
        flex="1"
        minH="280px"
        bg="#07080A"
        borderWidth="1px"
        borderColor="surface.300"
        borderRadius="md"
        p={3}
        overflowY="auto"
        fontFamily="mono"
        fontSize="xs"
        lineHeight="1.7"
        cursor="text"
        onClick={() => inputRef.current?.focus()}
      >
        {result?.transcript.map((entry, index) => (
          <Box key={`${entry.command}-${index}`}>
            <HStack spacing={2} align="baseline">
              <Text color="forge.500" flexShrink={0}>
                $
              </Text>
              <Text color="ink.100">{entry.command}</Text>
            </HStack>
            {entry.stdout && (
              <Text color="ink.300" whiteSpace="pre-wrap">
                {entry.stdout.replace(/\n$/, '')}
              </Text>
            )}
            {entry.stderr && (
              <Text color="fail" whiteSpace="pre-wrap">
                {entry.stderr}
              </Text>
            )}
          </Box>
        ))}

        <HStack spacing={2} align="baseline">
          <Text color="forge.500" flexShrink={0}>
            $
          </Text>
          <Box
            as="input"
            ref={inputRef}
            value={input}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            bg="transparent"
            border="none"
            outline="none"
            color="ink.100"
            fontFamily="mono"
            fontSize="xs"
            flex="1"
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal input"
          />
        </HStack>

        <Box ref={bottomRef} />
      </Box>

      <HStack justify="space-between">
        <Text fontSize="xs" color="ink.500">
          Running is free — nothing is recorded until you check your work.
        </Text>
        <HStack spacing={2}>
          <Button
            variant="ghost"
            size="xs"
            color="ink.500"
            onClick={() => {
              setCommands([]);
              setResult(null);
              setGraded(null);
            }}
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void check()}
            isLoading={submit.isPending}
            isDisabled={!challenge.attemptId || commands.length === 0}
          >
            Check my work
          </Button>
        </HStack>
      </HStack>

      {live && (
        <Box borderTopWidth="1px" borderColor="surface.300" pt={4}>
          <HStack justify="space-between" mb={2}>
            <Text
              fontSize="xs"
              textTransform="uppercase"
              letterSpacing="0.06em"
              color="ink.500"
              fontWeight={600}
            >
              {graded ? 'Graded' : 'Progress'}
            </Text>
            {graded && (
              <Text fontSize="sm" fontWeight={600} color={graded.passed ? 'pass' : 'fail'}>
                {graded.passed ? 'Solved' : 'Not yet'}
              </Text>
            )}
          </HStack>

          <VStack align="stretch" spacing={1}>
            {live.checks.map((item) => (
              <HStack key={item.description} spacing={2} align="flex-start">
                <Box
                  as={item.passed ? FiCheck : FiX}
                  color={item.passed ? 'pass' : 'ink.500'}
                  fontSize="sm"
                  flexShrink={0}
                  mt="2px"
                />
                <Text fontSize="xs" color={item.passed ? 'ink.200' : 'ink.400'}>
                  {item.description}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Box>
      )}
    </VStack>
  );
}
