import {
  Badge,
  Box,
  Button,
  Grid,
  GridItem,
  HStack,
  Heading,
  Spinner,
  Text,
  Textarea,
  VStack,
} from '@chakra-ui/react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  useChallenge,
  useStartChallenge,
  useSubmitWritten,
  type WrittenReviewResult,
} from '~/lib/queries';

import { TerminalPane } from './TerminalPane';

/**
 * One engineering challenge (§18-19).
 *
 * The brief on the left, the work on the right. What the brief does *not*
 * contain is the point: an incident's root cause and a design's expected
 * topics are the answer, and the server withholds both until the user has
 * committed to something of their own.
 */
export function ChallengeWorkspace() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const { data: challenge, isLoading } = useChallenge(exerciseId);
  const start = useStartChallenge();
  const submit = useSubmitWritten();

  const [text, setText] = useState('');
  const [review, setReview] = useState<WrittenReviewResult | null>(null);

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!challenge) {
    return (
      <Box py={20} textAlign="center">
        <Text fontSize="sm" color="ink.400">
          This challenge could not be loaded.
        </Text>
      </Box>
    );
  }

  const started = Boolean(challenge.attemptId);

  const send = async () => {
    if (!challenge.attemptId || text.trim().length === 0) return;
    const outcome = await submit.mutateAsync({
      exerciseId: challenge.exerciseId,
      attemptId: challenge.attemptId,
      text,
    });
    setReview(outcome);
  };

  return (
    <Grid templateColumns={{ base: '1fr', lg: '460px 1fr' }} h="100%" minH={0}>
      {/* Brief */}
      <GridItem
        borderRightWidth="1px"
        borderColor="surface.300"
        bg="surface.50"
        overflowY="auto"
        p={6}
        minW={0}
      >
        <HStack spacing={2} mb={3}>
          <Badge bg="forge.500" color="surface.0" fontSize="xs">
            {challenge.kind.replace('_', ' ')}
          </Badge>
          <Text fontSize="xs" color="ink.500">
            {challenge.technologyName} · {challenge.estimatedMinutes} min
          </Text>
        </HStack>

        <Heading size="sm" color="ink.100" mb={3} lineHeight="1.4">
          {challenge.title}
        </Heading>

        <Text fontSize="sm" color="ink.200" whiteSpace="pre-wrap" lineHeight="1.7" mb={5}>
          {challenge.brief.body}
        </Text>

        {challenge.brief.constraints.length > 0 && (
          <Box mb={5}>
            <Label>Constraints</Label>
            <VStack align="stretch" spacing={1}>
              {challenge.brief.constraints.map((constraint) => (
                <Text key={constraint} fontSize="sm" color="ink.300">
                  · {constraint}
                </Text>
              ))}
            </VStack>
          </Box>
        )}

        {challenge.brief.telemetry && (
          <Box mb={5}>
            <Label>Telemetry</Label>
            {/* Shown in full. In a real incident the signal was always
                there — hiding some of it would test luck, not diagnosis. */}
            <Box
              bg="#07080A"
              borderWidth="1px"
              borderColor="surface.300"
              borderRadius="md"
              p={3}
              overflowX="auto"
            >
              <Text
                fontFamily="mono"
                fontSize="xs"
                color="ink.300"
                whiteSpace="pre"
                lineHeight="1.6"
              >
                {challenge.brief.telemetry}
              </Text>
            </Box>
          </Box>
        )}

        {challenge.brief.sections.length > 0 && (
          <Box mb={5}>
            <Label>Cover these</Label>
            <VStack align="stretch" spacing={1}>
              {challenge.brief.sections.map((section) => (
                <Text key={section} fontSize="sm" color="ink.300">
                  · {section}
                </Text>
              ))}
            </VStack>
          </Box>
        )}

        {challenge.brief.terminal && (
          <Box>
            <Label>Done when</Label>
            <VStack align="stretch" spacing={1}>
              {challenge.brief.terminal.goals.map((goal) => (
                <Text key={goal} fontSize="sm" color="ink.300">
                  · {goal}
                </Text>
              ))}
            </VStack>
          </Box>
        )}
      </GridItem>

      {/* Work */}
      <GridItem overflowY="auto" p={6} minW={0} display="flex" flexDirection="column">
        {!started ? (
          <Box textAlign="center" py={16}>
            <Text fontSize="sm" color="ink.400" mb={5}>
              {challenge.kind === 'TERMINAL'
                ? 'A simulated shell. Explore freely — nothing is graded until you ask.'
                : 'Read the brief, then write your answer. You get one review per submission.'}
            </Text>
            <Button
              onClick={() => exerciseId && start.mutate(exerciseId)}
              isLoading={start.isPending}
            >
              Start
            </Button>
          </Box>
        ) : challenge.kind === 'TERMINAL' ? (
          <TerminalPane challenge={challenge} />
        ) : (
          <>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                challenge.kind === 'INCIDENT'
                  ? 'What is your diagnosis, and what in the telemetry tells you?'
                  : 'Your design. Prose is fine — this is judged as an interview answer, not a document.'
              }
              minH="320px"
              bg="surface.50"
              borderColor="surface.400"
              fontSize="sm"
              fontFamily="mono"
              lineHeight="1.7"
              resize="vertical"
              _focusVisible={{ borderColor: 'forge.500', boxShadow: 'none' }}
            />

            <HStack justify="space-between" mt={3}>
              <Text fontSize="xs" color="ink.500">
                {text.trim().split(/\s+/).filter(Boolean).length} words
              </Text>
              <Button
                size="sm"
                onClick={() => void send()}
                isLoading={submit.isPending}
                loadingText="Reviewing"
                isDisabled={text.trim().length < 40}
              >
                Submit for review
              </Button>
            </HStack>

            {review && (
              <Box mt={8}>
                <WrittenReview review={review} />
              </Box>
            )}
          </>
        )}
      </GridItem>
    </Grid>
  );
}

const SEVERITY_COLOUR: Record<string, string> = {
  critical: 'fail',
  major: 'warn',
  minor: 'ink.300',
};

function WrittenReview({ review }: { review: WrittenReviewResult }) {
  const scored = Object.entries(review.scores).filter(([, value]) => value !== null) as [
    string,
    number,
  ][];

  return (
    <Box borderTopWidth="1px" borderColor="surface.300" pt={6}>
      <HStack justify="space-between" mb={5}>
        <Heading size="sm" color="ink.100">
          Review
        </Heading>
        <Text fontSize="sm" fontWeight={600} color={review.passed ? 'pass' : 'warn'}>
          {review.passed ? 'Holds up' : 'Needs work'}
        </Text>
      </HStack>

      <Text fontSize="sm" color="ink.200" lineHeight="1.7" mb={6}>
        {review.summary}
      </Text>

      {scored.length > 0 && (
        <Box mb={6}>
          <Label>Scored</Label>
          <VStack align="stretch" spacing={2}>
            {scored.map(([dimension, value]) => (
              <HStack key={dimension} spacing={3}>
                <Text fontSize="xs" color="ink.400" minW="180px">
                  {humanise(dimension)}
                </Text>
                <Box flex="1" h="4px" bg="surface.300" borderRadius="full" overflow="hidden">
                  <Box
                    h="100%"
                    w={`${Math.round(value * 100)}%`}
                    bg={value >= 0.7 ? 'pass' : value >= 0.45 ? 'warn' : 'fail'}
                  />
                </Box>
                <Text fontSize="xs" color="ink.400" minW="28px" textAlign="right">
                  {Math.round(value * 100)}
                </Text>
              </HStack>
            ))}
          </VStack>
          <Text fontSize="xs" color="ink.500" mt={3}>
            Anything you did not address is left out, not scored zero.
          </Text>
        </Box>
      )}

      {review.strengths.length > 0 && (
        <Box mb={5}>
          <Label>Holds up</Label>
          <VStack align="stretch" spacing={1}>
            {review.strengths.map((strength) => (
              <Text key={strength} fontSize="sm" color="ink.200">
                · {strength}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {review.issues.length > 0 && (
        <Box mb={5}>
          <Label>Gaps</Label>
          <VStack align="stretch" spacing={3}>
            {review.issues.map((issue) => (
              <Box
                key={issue.title}
                borderLeftWidth="2px"
                borderColor={SEVERITY_COLOUR[issue.severity] ?? 'ink.500'}
                pl={3}
              >
                <HStack spacing={2} mb={1}>
                  <Text
                    fontSize="xs"
                    textTransform="uppercase"
                    letterSpacing="0.04em"
                    color={SEVERITY_COLOUR[issue.severity] ?? 'ink.500'}
                    fontWeight={600}
                  >
                    {issue.severity}
                  </Text>
                </HStack>
                <Text fontSize="sm" color="ink.100" fontWeight={500} mb={1}>
                  {issue.title}
                </Text>
                <Text fontSize="xs" color="ink.300" lineHeight="1.6">
                  {issue.explanation}
                </Text>
              </Box>
            ))}
          </VStack>
        </Box>
      )}

      {review.missedSignals && review.missedSignals.length > 0 && (
        <Box mb={5}>
          <Label>Evidence you walked past</Label>
          <VStack align="stretch" spacing={1}>
            {review.missedSignals.map((signal) => (
              <Text key={signal} fontSize="sm" color="ink.200">
                · {signal}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {review.rootCause && (
        <Box mb={5}>
          {/* Released only now. Showing it beside the brief would have made
              this a reading exercise. */}
          <Label>What it actually was</Label>
          <Text fontSize="sm" color="ink.200" whiteSpace="pre-wrap" lineHeight="1.7">
            {review.rootCause}
          </Text>
        </Box>
      )}

      {review.followUpQuestions.length > 0 && (
        <Box>
          <Label>What you would be asked next</Label>
          <VStack align="stretch" spacing={1}>
            {review.followUpQuestions.map((question) => (
              <Text key={question} fontSize="sm" color="ink.300">
                · {question}
              </Text>
            ))}
          </VStack>
        </Box>
      )}
    </Box>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize="xs"
      textTransform="uppercase"
      letterSpacing="0.06em"
      color="ink.500"
      fontWeight={600}
      mb={2}
    >
      {children}
    </Text>
  );
}

function humanise(dimension: string): string {
  return dimension
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}
