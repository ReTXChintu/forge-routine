import { Badge, Box, Button, HStack, Text, VStack } from '@chakra-ui/react';
import { useState } from 'react';
import { FiCheck, FiX } from 'react-icons/fi';

import { useAnswerRecall, type RecallAnswerResult, type RecallPromptView } from '~/lib/queries';

/**
 * A recall prompt (docs/learning-path.md).
 *
 * **Where this may appear is a product rule, not a styling choice.** Only at
 * boundaries: session start, after a submission has been graded, between
 * routine items. Never during coding. An interruption mid-problem destroys
 * the exact mental state the product exists to build, and teaches the user to
 * dismiss prompts unread — at which point the spaced-repetition data becomes
 * noise and every schedule built on it is wrong.
 *
 * The component enforces nothing itself; the caller chooses the moment. What
 * it does enforce is that the answer is never revealed before a choice is
 * made, and that the explanation is shown either way — being right for the
 * wrong reason is still worth correcting.
 */
export function RecallPrompt({
  prompt,
  onDone,
  onSkip,
}: {
  prompt: RecallPromptView;
  onDone: (result: RecallAnswerResult) => void;
  onSkip?: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<RecallAnswerResult | null>(null);
  const answer = useAnswerRecall();

  const submit = async (index: number) => {
    setSelected(index);
    const outcome = await answer.mutateAsync({
      questionId: prompt.id,
      selectedIndex: index,
    });
    setResult(outcome);
  };

  return (
    <Box
      borderWidth="1px"
      borderColor={result ? (result.correct ? 'pass' : 'fail') : 'surface.300'}
      borderRadius="md"
      bg="surface.50"
      p={5}
      maxW="620px"
      w="100%"
    >
      <HStack justify="space-between" mb={3}>
        <HStack spacing={2}>
          <Badge bg="surface.300" color="ink.300" fontSize="xs">
            Recall
          </Badge>
          <Text fontSize="xs" color="ink.400">
            {prompt.technologyName} · {prompt.conceptName}
          </Text>
        </HStack>
        {!result && onSkip && (
          <Button variant="ghost" size="xs" color="ink.500" onClick={onSkip}>
            Skip
          </Button>
        )}
      </HStack>

      <Text fontSize="sm" color="ink.100" mb={4} lineHeight="1.6">
        {prompt.prompt}
      </Text>

      <VStack align="stretch" spacing={2}>
        {prompt.options.map((option, index) => {
          const isChosen = selected === index;
          const isAnswer = result?.correctIndex === index;

          // Nothing is coloured until an answer is committed, so the correct
          // option cannot be inferred from the styling.
          const state = !result ? 'pending' : isAnswer ? 'correct' : isChosen ? 'wrong' : 'neutral';

          return (
            <Button
              key={option}
              variant="outline"
              size="sm"
              justifyContent="flex-start"
              textAlign="left"
              whiteSpace="normal"
              h="auto"
              py={2.5}
              px={3}
              fontWeight={400}
              isDisabled={Boolean(result) || answer.isPending}
              isLoading={answer.isPending && isChosen}
              onClick={() => void submit(index)}
              borderColor={
                state === 'correct' ? 'pass' : state === 'wrong' ? 'fail' : 'surface.400'
              }
              color={state === 'neutral' ? 'ink.400' : 'ink.100'}
              _hover={result ? {} : { borderColor: 'forge.500', bg: 'surface.100' }}
              _disabled={{ opacity: state === 'neutral' ? 0.5 : 1, cursor: 'default' }}
            >
              <HStack spacing={2} w="100%">
                {state === 'correct' && <Box as={FiCheck} color="pass" flexShrink={0} />}
                {state === 'wrong' && <Box as={FiX} color="fail" flexShrink={0} />}
                <Text fontSize="sm">{option}</Text>
              </HStack>
            </Button>
          );
        })}
      </VStack>

      {result && (
        <Box mt={4} pt={4} borderTopWidth="1px" borderColor="surface.300">
          <Text fontSize="sm" color="ink.200" lineHeight="1.6" mb={3}>
            {result.explanation}
          </Text>
          <HStack justify="space-between">
            <Text fontSize="xs" color="ink.500">
              Next review {formatDue(result.nextDueAt)}
            </Text>
            <Button size="xs" onClick={() => onDone(result)}>
              Continue
            </Button>
          </HStack>
        </Box>
      )}
    </Box>
  );
}

function formatDue(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
}
