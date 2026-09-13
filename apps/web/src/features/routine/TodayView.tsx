import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  Progress,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useState } from 'react';
import { FiCheck, FiChevronRight, FiSkipForward } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

import { RecallPrompt } from '~/features/recall/RecallPrompt';
import {
  useGenerateRoutine,
  useRecallDue,
  useTodayRoutine,
  useUpdateRoutineItem,
  type RoutineItemView,
} from '~/lib/queries';

/**
 * Today (§20).
 *
 * The roadmap answers "where am I going". This answers "what do I do now",
 * and it is deliberately short: a list that fits the user's stated daily
 * budget and stops. Padding it to fill the screen produces busywork, and a
 * routine the user cannot finish is one they stop opening.
 *
 * Recall prompts appear **between** items, never inside one — the boundary is
 * the only safe moment (docs/learning-path.md).
 */

const KIND_LABEL: Record<string, string> = {
  LEARN: 'Read',
  RECALL: 'Recall',
  CODE: 'Write',
  BLIND_CODE: 'Blind',
  DEBUG: 'Debug',
  EXPLAIN: 'Explain',
  PROJECT: 'Project',
  CHECKPOINT: 'Checkpoint',
  REVIEW: 'Review',
  INTERVIEW: 'Interview',
};

export function TodayView() {
  const { data: routine, isLoading } = useTodayRoutine();
  const generate = useGenerateRoutine();
  const updateItem = useUpdateRoutineItem();
  const navigate = useNavigate();

  // Fetched up front so the boundary prompt appears without a spinner.
  const { data: duePrompts } = useRecallDue();
  const [promptIndex, setPromptIndex] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!routine) {
    return (
      <Box maxW="640px" mx="auto" px={6} py={20} textAlign="center">
        <Heading size="md" color="ink.100" mb={2}>
          Nothing planned yet
        </Heading>
        <Text fontSize="sm" color="ink.400" mb={6}>
          Today&apos;s work is a slice of your roadmap, weighted towards anything due for review.
        </Text>
        <Button
          onClick={() => generate.mutate(false)}
          isLoading={generate.isPending}
          loadingText="Planning"
        >
          Plan today
        </Button>
      </Box>
    );
  }

  const percent =
    routine.totalMinutes > 0
      ? Math.round((routine.completedMinutes / routine.totalMinutes) * 100)
      : 0;

  const remaining = routine.items.filter((item) => item.status === 'PENDING');
  const finished = routine.items.length > 0 && remaining.length === 0;

  const open = (item: RoutineItemView) => {
    if (item.exerciseId) {
      navigate(`${item.kind === 'PROJECT' ? '/project' : '/exercise'}/${item.exerciseId}`);
    } else if (item.conceptId) {
      navigate(`/concept/${item.conceptId}`);
    }
  };

  /**
   * Completing an item is the boundary. If something is due, it is offered
   * here — one prompt, then the user moves on.
   */
  const complete = (item: RoutineItemView) => {
    updateItem.mutate({ id: item.id, status: 'DONE' });
    if (duePrompts && promptIndex < duePrompts.length) setShowPrompt(true);
  };

  const currentPrompt = showPrompt ? duePrompts?.[promptIndex] : undefined;

  return (
    <Box maxW="720px" mx="auto" px={6} py={8}>
      <HStack justify="space-between" align="flex-start" mb={1}>
        <Heading size="md" color="ink.100">
          Today
        </Heading>
        <Button
          variant="ghost"
          size="xs"
          color="ink.500"
          onClick={() => generate.mutate(true)}
          isLoading={generate.isPending}
        >
          Replan
        </Button>
      </HStack>

      <Text fontSize="sm" color="ink.400" mb={5}>
        {routine.completedMinutes} of {routine.totalMinutes} minutes
        {routine.recallDue > 0 && ` · ${routine.recallDue} due for review`}
      </Text>

      <Progress
        value={percent}
        size="xs"
        borderRadius="full"
        bg="surface.200"
        sx={{ '& > div': { bg: percent === 100 ? 'pass' : 'forge.500' } }}
        mb={6}
      />

      {currentPrompt && (
        <Box mb={6}>
          <RecallPrompt
            prompt={currentPrompt}
            onDone={() => {
              setPromptIndex((index) => index + 1);
              setShowPrompt(false);
            }}
            onSkip={() => setShowPrompt(false)}
          />
        </Box>
      )}

      <VStack align="stretch" spacing={2}>
        {routine.items.map((item) => (
          <RoutineRow
            key={item.id}
            item={item}
            onOpen={() => open(item)}
            onComplete={() => complete(item)}
            onSkip={() => updateItem.mutate({ id: item.id, status: 'SKIPPED' })}
          />
        ))}
      </VStack>

      {finished && (
        <Box mt={8} textAlign="center">
          <Text fontSize="sm" color="ink.300">
            That is today&apos;s work done.
          </Text>
          {/* No confetti, no streak counter. Finishing is the reward; a
              celebration loop trains people to chase the animation. */}
          <Text fontSize="xs" color="ink.500" mt={1}>
            Stopping here is the right call — tomorrow&apos;s spacing depends on it.
          </Text>
        </Box>
      )}
    </Box>
  );
}

function RoutineRow({
  item,
  onOpen,
  onComplete,
  onSkip,
}: {
  item: RoutineItemView;
  onOpen: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const done = item.status === 'DONE';
  const skipped = item.status === 'SKIPPED';
  const openable = Boolean(item.exerciseId || item.conceptId);

  return (
    <HStack
      borderWidth="1px"
      borderColor="surface.300"
      borderRadius="md"
      bg={done ? 'transparent' : 'surface.50'}
      px={4}
      py={3}
      spacing={4}
      opacity={done || skipped ? 0.5 : 1}
      align="flex-start"
      role="group"
    >
      <Badge
        bg={item.kind === 'REVIEW' ? 'surface.300' : 'surface.200'}
        color={item.kind === 'REVIEW' ? 'info' : 'ink.300'}
        fontSize="xs"
        mt="1px"
        flexShrink={0}
      >
        {KIND_LABEL[item.kind] ?? item.kind}
      </Badge>

      <Box flex="1" minW={0}>
        <HStack spacing={2}>
          <Text
            fontSize="sm"
            fontWeight={500}
            color="ink.100"
            textDecoration={done || skipped ? 'line-through' : 'none'}
            cursor={openable && !done ? 'pointer' : 'default'}
            onClick={openable && !done ? onOpen : undefined}
            _hover={openable && !done ? { color: 'forge.400' } : {}}
          >
            {item.title}
          </Text>
          {openable && !done && !skipped && (
            <Box as={FiChevronRight} color="ink.500" fontSize="sm" />
          )}
        </HStack>
        {/* The reason is always shown. An opaque routine is not a trusted one. */}
        <Text fontSize="xs" color="ink.400" mt={0.5}>
          {item.rationale}
        </Text>
      </Box>

      <HStack spacing={1} flexShrink={0}>
        <Text fontSize="xs" color="ink.500" minW="32px" textAlign="right">
          {item.minutes}m
        </Text>
        {!done && !skipped && (
          <>
            <Button
              variant="ghost"
              size="xs"
              color="ink.500"
              onClick={onSkip}
              aria-label="Skip"
              _hover={{ color: 'ink.300' }}
            >
              <Box as={FiSkipForward} />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              color="ink.400"
              onClick={onComplete}
              aria-label="Mark done"
              _hover={{ color: 'pass' }}
            >
              <Box as={FiCheck} />
            </Button>
          </>
        )}
        {done && <Box as={FiCheck} color="pass" fontSize="sm" />}
      </HStack>
    </HStack>
  );
}
