import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  HStack,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useState } from 'react';

import type { HintKind } from '@forgeroutine/shared-types';

/**
 * The assistance ladder (§9).
 *
 * The rungs are presented plainly and in order, with `Show solution` visually
 * de-emphasised and gated. The point is not to make help hard to get — it is to
 * make the cheap step the obvious one, and to make choosing the expensive step a
 * decision rather than a reflex.
 */

interface Rung {
  kind: HintKind;
  label: string;
  description: string;
}

const RUNGS: Rung[] = [
  {
    kind: 'CONCEPT_REMINDER',
    label: 'Concept reminder',
    description: 'The underlying idea, without looking at your code',
  },
  {
    kind: 'SMALL_HINT',
    label: 'Small hint',
    description: 'One question to narrow things down',
  },
  {
    kind: 'DEBUGGING_QUESTION',
    label: 'Debugging question',
    description: 'What did you expect, and what happened?',
  },
  {
    kind: 'EXPLAIN_ERROR',
    label: 'Explain this error',
    description: 'What the error means in general',
  },
  { kind: 'HINT', label: 'Hint', description: 'Where the problem is' },
  { kind: 'SHOW_APPROACH', label: 'Show approach', description: 'The algorithm, in prose' },
];

export interface HintEntry {
  kind: HintKind;
  message: string;
  intervention: string | null;
}

interface AssistancePanelProps {
  enabled: boolean;
  blindMode: boolean;
  hints: HintEntry[];
  pending: HintKind | null;
  gateMessage: string | null;
  onRequest: (kind: HintKind, overrideGate?: boolean) => void;
}

export function AssistancePanel({
  enabled,
  blindMode,
  hints,
  pending,
  gateMessage,
  onRequest,
}: AssistancePanelProps) {
  const [confirmingSolution, setConfirmingSolution] = useState(false);

  if (blindMode) {
    return (
      <Box p={4}>
        <Alert status="info" variant="left-accent" bg="surface.200" fontSize="sm">
          <AlertIcon color="info" />
          <Box>
            <Text fontWeight={600}>Blind Coding</Text>
            <Text color="ink.300">
              No assistance, no solution. Everything is evaluated after you submit.
            </Text>
          </Box>
        </Alert>
      </Box>
    );
  }

  if (!enabled) {
    return (
      <Box p={4}>
        <Alert status="info" variant="left-accent" bg="surface.200" fontSize="sm">
          <AlertIcon color="info" />
          <Box>
            <Text fontWeight={600}>Interview conditions</Text>
            <Text color="ink.300">
              Assistance is off at this level, as it would be in a real interview.
            </Text>
          </Box>
        </Alert>
      </Box>
    );
  }

  return (
    <VStack align="stretch" spacing={3} p={4} overflowY="auto" h="100%">
      <HStack justify="space-between">
        <Text fontSize="xs" fontWeight={700} color="ink.400" letterSpacing="0.06em">
          ASSISTANCE
        </Text>
        {hints.length > 0 && (
          <Badge bg="surface.300" color="ink.300" fontSize="xs">
            {hints.length} used
          </Badge>
        )}
      </HStack>

      <VStack align="stretch" spacing={1}>
        {RUNGS.map((rung) => (
          <Button
            key={rung.kind}
            variant="ghost"
            justifyContent="flex-start"
            h="auto"
            py={2}
            px={3}
            isLoading={pending === rung.kind}
            onClick={() => onRequest(rung.kind)}
          >
            <Box textAlign="left">
              <Text fontSize="sm" color="ink.200">
                {rung.label}
              </Text>
              <Text fontSize="xs" color="ink.400" fontWeight={400}>
                {rung.description}
              </Text>
            </Box>
          </Button>
        ))}
      </VStack>

      <Divider borderColor="surface.300" />

      {/* Deliberately separated and quiet: available, never the default. */}
      {confirmingSolution ? (
        <VStack align="stretch" spacing={2}>
          <Text fontSize="xs" color="ink.300">
            {gateMessage ?? 'This ends the independent run for this attempt.'}
          </Text>
          <HStack>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setConfirmingSolution(false);
                onRequest('SHOW_SOLUTION', true);
              }}
            >
              Show it anyway
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirmingSolution(false)}>
              Keep trying
            </Button>
          </HStack>
        </VStack>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          color="ink.500"
          justifyContent="flex-start"
          isLoading={pending === 'SHOW_SOLUTION'}
          onClick={() => setConfirmingSolution(true)}
        >
          Show solution
        </Button>
      )}

      {hints.length > 0 && <Divider borderColor="surface.300" />}

      <VStack align="stretch" spacing={3}>
        {hints.map((hint, index) => (
          <Box
            key={`${hint.kind}-${index}`}
            bg="surface.200"
            borderWidth="1px"
            borderColor={hint.intervention ? 'forge.700' : 'surface.300'}
            borderRadius="md"
            p={3}
          >
            <Text fontSize="xs" color="ink.500" mb={1} letterSpacing="0.04em">
              {hint.kind.replace(/_/g, ' ')}
            </Text>
            <Text fontSize="sm" color="ink.200" whiteSpace="pre-wrap">
              {hint.message}
            </Text>
          </Box>
        ))}
      </VStack>
    </VStack>
  );
}
