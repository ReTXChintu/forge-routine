import {
  Box,
  Button,
  HStack,
  Heading,
  Spinner,
  Text,
  Textarea,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  useAnswerInterview,
  useEndInterview,
  useInterview,
  useInterviewReport,
  type InterviewReportView,
} from '~/lib/queries';

/**
 * A live interview (§15-16).
 *
 * Deliberately bare: one question, one box, no scores, no progress bar
 * counting down to a grade. Feedback shown between turns would turn this into
 * a tutorial, and the user would start answering for approval rather than
 * saying what they actually think — which is the one thing an interview is
 * for.
 *
 * The transcript stays visible above, because being able to see what you
 * already said is normal in a conversation and hiding it only adds anxiety.
 */
export function InterviewSession() {
  const { interviewId } = useParams<{ interviewId: string }>();
  const { data: interview, isLoading } = useInterview(interviewId);
  const answer = useAnswerInterview();
  const end = useEndInterview();

  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const finished = interview?.status !== 'IN_PROGRESS';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [interview?.turns.length]);

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!interview) {
    return (
      <Box maxW="640px" mx="auto" px={6} py={20} textAlign="center">
        <Text fontSize="sm" color="ink.400">
          This interview could not be loaded.
        </Text>
      </Box>
    );
  }

  const send = async () => {
    if (!interview.currentQuestion || text.trim().length === 0) return;
    const body = text;
    setText('');
    await answer.mutateAsync({
      interviewId: interview.id,
      questionId: interview.currentQuestion.id,
      text: body,
    });
  };

  return (
    <Box maxW="760px" mx="auto" px={6} py={8}>
      <HStack justify="space-between" mb={6}>
        <Box>
          <Heading size="sm" color="ink.100">
            {interview.mode.replace('_', ' ')} interview
          </Heading>
          <Text fontSize="xs" color="ink.500">
            {interview.targetLevel.toLowerCase()} level
            {!finished && ` · up to ${interview.turnsRemaining} questions left`}
          </Text>
        </Box>
        {!finished && (
          <Button
            variant="ghost"
            size="xs"
            color="ink.500"
            onClick={() => end.mutate(interview.id)}
            isLoading={end.isPending}
          >
            End and get feedback
          </Button>
        )}
      </HStack>

      <VStack align="stretch" spacing={6} mb={8}>
        {interview.turns.map((turn) => (
          <Box key={turn.questionId}>
            {turn.conceptName && (
              <Text
                fontSize="xs"
                color="ink.500"
                textTransform="uppercase"
                letterSpacing="0.06em"
                mb={1.5}
              >
                {turn.conceptName}
              </Text>
            )}
            <Text fontSize="sm" color="ink.100" lineHeight="1.7" mb={turn.answer ? 3 : 0}>
              {turn.prompt}
            </Text>
            {turn.answer && (
              <Box borderLeftWidth="2px" borderColor="surface.400" pl={4} py={0.5}>
                <Text fontSize="sm" color="ink.300" lineHeight="1.7" whiteSpace="pre-wrap">
                  {turn.answer}
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </VStack>

      {answer.isPending && (
        <HStack spacing={2} mb={6} color="ink.500">
          <Spinner size="xs" />
          <Text fontSize="xs">Thinking about your answer…</Text>
        </HStack>
      )}

      {!finished && interview.currentQuestion && !answer.isPending && (
        <Box>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Answer as you would out loud."
            rows={6}
            bg="surface.50"
            borderColor="surface.400"
            fontSize="sm"
            resize="vertical"
            _focusVisible={{ borderColor: 'forge.500', boxShadow: 'none' }}
            onKeyDown={(event) => {
              // Enter inserts a newline: an interview answer is a paragraph,
              // and submitting on Enter would cut people off mid-thought.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
            }}
          />
          <HStack justify="space-between" mt={2}>
            <Text fontSize="xs" color="ink.500">
              ⌘↵ to send. Nothing is graded in front of you — you get the debrief at the end.
            </Text>
            <Button size="sm" onClick={() => void send()} isDisabled={text.trim().length === 0}>
              Send
            </Button>
          </HStack>
        </Box>
      )}

      {finished && <Debrief interviewId={interview.id} inline={end.data ?? null} />}

      <Box ref={bottomRef} />
    </Box>
  );
}

function Debrief({
  interviewId,
  inline,
}: {
  interviewId: string;
  inline: InterviewReportView | null;
}) {
  const { data: fetched, isLoading } = useInterviewReport(inline ? undefined : interviewId);
  const report = inline ?? fetched;

  if (isLoading) {
    return (
      <HStack justify="center" py={10}>
        <Spinner size="sm" color="forge.500" />
      </HStack>
    );
  }

  if (!report) return null;

  const scored = Object.entries(report.dimensions).filter(
    ([, value]) => value !== null,
  ) as [string, number][];

  return (
    <Box borderTopWidth="1px" borderColor="surface.300" pt={7} mt={2}>
      <HStack justify="space-between" align="baseline" mb={5}>
        <Heading size="sm" color="ink.100">
          Debrief
        </Heading>
        {report.overallScore !== null && (
          <Text fontSize="2xl" fontWeight={700} color="forge.500" lineHeight="1">
            {Math.round(report.overallScore * 100)}%
          </Text>
        )}
      </HStack>

      {report.degraded && (
        <Text fontSize="xs" color="warn" mb={4}>
          This debrief is the arithmetic only — the written review could not be generated.
        </Text>
      )}

      {report.summary && (
        <Text fontSize="sm" color="ink.200" lineHeight="1.7" mb={6}>
          {report.summary}
        </Text>
      )}

      {scored.length > 0 && (
        <Box mb={6}>
          <Label>Scored</Label>
          <VStack align="stretch" spacing={2}>
            {scored.map(([dimension, value]) => (
              <HStack key={dimension} spacing={3}>
                <Text fontSize="xs" color="ink.400" minW="160px">
                  {humanise(dimension)}
                </Text>
                <Box flex="1" h="4px" bg="surface.300" borderRadius="full" overflow="hidden">
                  <Box
                    h="100%"
                    w={`${Math.round(value * 100)}%`}
                    bg={value >= 0.7 ? 'pass' : value >= 0.45 ? 'warn' : 'fail'}
                  />
                </Box>
                <Text fontSize="xs" color="ink.400" minW="32px" textAlign="right">
                  {Math.round(value * 100)}
                </Text>
              </HStack>
            ))}
          </VStack>
          {/* Unscored dimensions are omitted rather than shown at zero: this
              interview did not test them, and a zero would get acted on. */}
          <Text fontSize="xs" color="ink.500" mt={3}>
            Dimensions this interview did not test are left out, not scored zero.
          </Text>
        </Box>
      )}

      {report.strongAreas.length > 0 && (
        <Box mb={5}>
          <Label>Held up</Label>
          <VStack align="stretch" spacing={1}>
            {report.strongAreas.map((area) => (
              <Text key={area} fontSize="sm" color="ink.200">
                · {area}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {report.weakAreas.length > 0 && (
        <Box mb={5}>
          <Label>Did not</Label>
          <VStack align="stretch" spacing={1}>
            {report.weakAreas.map((area) => (
              <Text key={area} fontSize="sm" color="ink.200">
                · {area}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {report.recommendedTopics.length > 0 && (
        <Box>
          <Label>Study next</Label>
          <Text fontSize="sm" color="ink.300">
            {report.recommendedTopics.join(' · ')}
          </Text>
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
