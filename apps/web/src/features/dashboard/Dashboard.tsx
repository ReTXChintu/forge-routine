import {
  Box,
  Button,
  Grid,
  GridItem,
  HStack,
  Heading,
  Progress,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';

import type { IndependentCodingScore, WeakSkill } from '@forgeroutine/shared-types';

import { useOverview } from '~/lib/queries';

/**
 * The dashboard (§23): information-dense, no decorative charts.
 *
 * Every number here is either actionable or diagnostic. The Independent Coding
 * Score is the headline because it is the one thing this product is for.
 */
export function Dashboard() {
  const { data, isLoading } = useOverview();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!data) return null;

  return (
    <Box maxW="1200px" mx="auto" px={6} py={8}>
      <Heading size="lg" mb={6} fontWeight={650}>
        {data.greeting}
      </Heading>

      <Grid templateColumns={{ base: '1fr', md: 'repeat(3, 1fr)' }} gap={4} mb={6}>
        <Metric
          label="Today"
          value={`${data.todayMinutesDone} / ${data.todayMinutesTarget}`}
          unit="min"
          progress={
            data.todayMinutesTarget > 0 ? data.todayMinutesDone / data.todayMinutesTarget : 0
          }
        />
        <IndependenceCard score={data.independence} />
        <Metric
          label="Interview readiness"
          value={
            data.interviewReadiness === null ? '—' : `${Math.round(data.interviewReadiness * 100)}%`
          }
          progress={data.interviewReadiness ?? 0}
          muted={data.interviewReadiness === null}
          note={data.interviewReadiness === null ? 'Not enough evidence yet' : undefined}
        />
      </Grid>

      <Grid templateColumns={{ base: '1fr', lg: '2fr 1fr' }} gap={4}>
        <GridItem>
          <Panel title="Next">
            {data.nextAction ? (
              <VStack align="stretch" spacing={3}>
                <Box>
                  <Text fontSize="lg" fontWeight={600} color="ink.100">
                    {data.nextAction.title}
                  </Text>
                  {/* The rationale is shown deliberately: an opaque recommendation
                      is not a trusted one. */}
                  <Text fontSize="sm" color="ink.400" mt={1}>
                    {data.nextAction.rationale}
                  </Text>
                </Box>
                <HStack>
                  <Button
                    isDisabled={!data.nextAction.exerciseId}
                    onClick={() =>
                      data.nextAction?.exerciseId &&
                      navigate(`/exercise/${data.nextAction.exerciseId}`)
                    }
                  >
                    Start · {data.nextAction.estimatedMinutes} min
                  </Button>
                  {data.nextAction.conceptId && (
                    <Button
                      variant="ghost"
                      onClick={() => navigate(`/concept/${data.nextAction?.conceptId}`)}
                    >
                      Read first
                    </Button>
                  )}
                </HStack>
              </VStack>
            ) : (
              <VStack align="stretch" spacing={3}>
                <Text fontSize="sm" color="ink.400">
                  Nothing queued. Add a technology to start building a routine.
                </Text>
                <Button alignSelf="flex-start" onClick={() => navigate('/technologies')}>
                  Add a technology
                </Button>
              </VStack>
            )}
          </Panel>
        </GridItem>

        <GridItem>
          <Panel title="Weakest">
            {data.weakestSkills.length === 0 ? (
              <Text fontSize="sm" color="ink.500">
                Practise something and this will fill in.
              </Text>
            ) : (
              <VStack align="stretch" spacing={2}>
                {data.weakestSkills.map((skill, index) => (
                  <WeakSkillRow key={skill.conceptId} rank={index + 1} skill={skill} />
                ))}
              </VStack>
            )}
          </Panel>

          {data.currentFocus.length > 0 && (
            <Box mt={4}>
              <Panel title="Current focus">
                <Text fontSize="sm" color="ink.200">
                  {data.currentFocus.join(' · ')}
                </Text>
              </Panel>
            </Box>
          )}
        </GridItem>
      </Grid>
    </Box>
  );
}

function IndependenceCard({ score }: { score: IndependentCodingScore }) {
  const insufficient = score.status === 'INSUFFICIENT_DATA';

  return (
    <Box bg="surface.100" borderWidth="1px" borderColor="surface.300" borderRadius="lg" p={4}>
      <Text fontSize="xs" color="ink.400" letterSpacing="0.06em" mb={2}>
        INDEPENDENT CODING
      </Text>

      {insufficient ? (
        <>
          <Text fontSize="2xl" fontWeight={650} color="ink.500" fontFamily="mono">
            —
          </Text>
          {/* Showing a new user "12%" would be both wrong and demoralising. */}
          <Text fontSize="xs" color="ink.500" mt={1}>
            {score.attemptsConsidered} of 5 attempts needed
          </Text>
        </>
      ) : (
        <>
          <HStack align="baseline" spacing={2}>
            <Text fontSize="3xl" fontWeight={700} color="forge.500" fontFamily="mono">
              {Math.round((score.score ?? 0) * 100)}%
            </Text>
            {score.deltaFromPreviousWindow !== null && score.deltaFromPreviousWindow !== 0 && (
              <Text
                fontSize="sm"
                fontFamily="mono"
                color={score.deltaFromPreviousWindow > 0 ? 'pass' : 'fail'}
              >
                {score.deltaFromPreviousWindow > 0 ? '+' : ''}
                {score.deltaFromPreviousWindow.toFixed(1)}
              </Text>
            )}
          </HStack>
          <Progress
            value={(score.score ?? 0) * 100}
            size="xs"
            mt={2}
            borderRadius="sm"
            sx={{ '& > div': { bg: 'forge.500' } }}
          />
          <Text fontSize="xs" color="ink.500" mt={1}>
            Last {score.windowDays} days · {score.attemptsConsidered} attempts
          </Text>
        </>
      )}
    </Box>
  );
}

function Metric({
  label,
  value,
  unit,
  progress,
  muted,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  progress: number;
  muted?: boolean;
  note?: string;
}) {
  return (
    <Box bg="surface.100" borderWidth="1px" borderColor="surface.300" borderRadius="lg" p={4}>
      <Text fontSize="xs" color="ink.400" letterSpacing="0.06em" mb={2}>
        {label.toUpperCase()}
      </Text>
      <HStack align="baseline" spacing={1}>
        <Text
          fontSize="2xl"
          fontWeight={650}
          color={muted ? 'ink.500' : 'ink.100'}
          fontFamily="mono"
        >
          {value}
        </Text>
        {unit && (
          <Text fontSize="sm" color="ink.500">
            {unit}
          </Text>
        )}
      </HStack>
      {!muted && (
        <Progress
          value={Math.min(100, progress * 100)}
          size="xs"
          mt={2}
          borderRadius="sm"
          sx={{ '& > div': { bg: 'ink.300' } }}
        />
      )}
      {note && (
        <Text fontSize="xs" color="ink.500" mt={1}>
          {note}
        </Text>
      )}
    </Box>
  );
}

function WeakSkillRow({ rank, skill }: { rank: number; skill: WeakSkill }) {
  return (
    <HStack spacing={3} align="flex-start">
      <Text fontSize="sm" color="ink.500" fontFamily="mono" w="16px">
        {rank}
      </Text>
      <Box flex="1" minW={0}>
        <Text fontSize="sm" color="ink.200" noOfLines={1}>
          {skill.conceptName}
        </Text>
        <Text fontSize="xs" color="ink.500">
          {skill.technologyName}
        </Text>
      </Box>
      <Text fontSize="sm" color="fail" fontFamily="mono">
        {Math.round(skill.value * 100)}%
      </Text>
    </HStack>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box bg="surface.100" borderWidth="1px" borderColor="surface.300" borderRadius="lg" p={4}>
      <Text fontSize="xs" color="ink.400" letterSpacing="0.06em" mb={3}>
        {title.toUpperCase()}
      </Text>
      {children}
    </Box>
  );
}
