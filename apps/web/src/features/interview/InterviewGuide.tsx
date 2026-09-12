import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  Select,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  useInterviewGuide,
  useInterviewHistory,
  useStartInterview,
  type GuideTechnology,
  type GuideTopic,
} from '~/lib/queries';

/**
 * The interview guide (§17): a readiness dossier, not a study plan.
 *
 * The roadmap answers "what should I learn next". This answers "if the
 * interview were tomorrow, where would I be caught out", and the two give
 * different answers on purpose. Topics are ordered by preparation value, so
 * what you already know sinks to the bottom — rereading it is the most
 * comfortable way to waste the time you have left.
 */

const MODES = [
  { value: 'QUICK', label: 'Quick — 3 areas, shallow' },
  { value: 'TECHNICAL', label: 'Technical — 4 areas' },
  { value: 'CODING', label: 'Coding' },
  { value: 'DEBUGGING', label: 'Debugging' },
  { value: 'SYSTEM_DESIGN', label: 'System design — 2 areas, deep' },
  { value: 'SENIOR', label: 'Senior — 5 areas, deep' },
];

const STATUS_COLOUR: Record<GuideTopic['status'], string> = {
  STRONG: 'pass',
  SHAKY: 'warn',
  WEAK: 'fail',
  UNPRACTISED: 'ink.500',
};

const STATUS_LABEL: Record<GuideTopic['status'], string> = {
  STRONG: 'Solid',
  SHAKY: 'Shaky',
  WEAK: 'Weak',
  UNPRACTISED: 'Untouched',
};

export function InterviewGuide() {
  const { data: guide, isLoading } = useInterviewGuide();
  const { data: history } = useInterviewHistory();
  const start = useStartInterview();
  const navigate = useNavigate();

  const [mode, setMode] = useState('TECHNICAL');
  const [level, setLevel] = useState('MID');

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  const begin = async () => {
    const interview = await start.mutateAsync({ mode, targetLevel: level });
    navigate(`/interview/${interview.id}`);
  };

  return (
    <Box maxW="820px" mx="auto" px={6} py={8}>
      <Heading size="md" color="ink.100" mb={1}>
        Interview readiness
      </Heading>
      <Text fontSize="sm" color="ink.400" mb={7}>
        Where you would be caught out, ordered by what is worth fixing first.
      </Text>

      {/* The headline number, or an honest refusal to give one. */}
      <HStack
        borderWidth="1px"
        borderColor="surface.300"
        borderRadius="md"
        bg="surface.50"
        p={5}
        mb={7}
        spacing={6}
        align="flex-start"
        flexWrap="wrap"
      >
        <Box minW="120px">
          {guide?.overallReadiness !== null && guide?.overallReadiness !== undefined ? (
            <>
              <Text fontSize="3xl" fontWeight={700} color="forge.500" lineHeight="1">
                {Math.round(guide.overallReadiness * 100)}%
              </Text>
              <Text fontSize="xs" color="ink.500" mt={1}>
                weighted readiness
              </Text>
            </>
          ) : (
            <>
              <Text fontSize="lg" fontWeight={600} color="ink.300" lineHeight="1.3">
                Not enough yet
              </Text>
              <Text fontSize="xs" color="ink.500" mt={1}>
                A number from two practised concepts would be a guess.
              </Text>
            </>
          )}
        </Box>

        <Box flex="1" minW="260px">
          <Select
            size="sm"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            mb={2}
            bg="surface.100"
            borderColor="surface.400"
          >
            {MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <HStack>
            <Select
              size="sm"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              bg="surface.100"
              borderColor="surface.400"
              maxW="140px"
            >
              <option value="JUNIOR">Junior</option>
              <option value="MID">Mid</option>
              <option value="SENIOR">Senior</option>
            </Select>
            <Button size="sm" onClick={() => void begin()} isLoading={start.isPending}>
              Start interview
            </Button>
          </HStack>
          {start.isError && (
            <Text fontSize="xs" color="fail" mt={2}>
              Practise something first — an interview on material you have never studied
              measures nothing.
            </Text>
          )}
        </Box>
      </HStack>

      {guide && guide.priorities.length > 0 && (
        <Box mb={8}>
          <SectionLabel>Fix these first</SectionLabel>
          <VStack align="stretch" spacing={2}>
            {guide.priorities.map((priority, index) => (
              <HStack
                key={priority.title}
                spacing={3}
                align="flex-start"
                borderWidth="1px"
                borderColor="surface.300"
                borderRadius="md"
                px={4}
                py={3}
              >
                <Text fontSize="sm" color="forge.500" fontWeight={700} minW="18px">
                  {index + 1}
                </Text>
                <Box flex="1" minW={0}>
                  <Text
                    fontSize="sm"
                    color="ink.100"
                    fontWeight={500}
                    cursor={priority.conceptId ? 'pointer' : 'default'}
                    _hover={priority.conceptId ? { color: 'forge.400' } : {}}
                    onClick={() =>
                      priority.conceptId && navigate(`/concept/${priority.conceptId}`)
                    }
                  >
                    {priority.title}
                  </Text>
                  <Text fontSize="xs" color="ink.400" mt={0.5}>
                    {priority.reason}
                  </Text>
                </Box>
              </HStack>
            ))}
          </VStack>
        </Box>
      )}

      {guide && guide.recurringWeaknesses.length > 0 && (
        <Box mb={8}>
          <SectionLabel>Came up more than once</SectionLabel>
          <Text fontSize="xs" color="ink.500" mb={2}>
            Weaknesses two or more past interviews agreed on. One interview is an off day;
            two is a pattern.
          </Text>
          <VStack align="stretch" spacing={1}>
            {guide.recurringWeaknesses.map((weakness) => (
              <Text key={weakness} fontSize="sm" color="ink.200">
                · {weakness}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      <Box mb={8}>
        <SectionLabel>By technology</SectionLabel>
        <VStack align="stretch" spacing={5}>
          {guide?.technologies.map((technology) => (
            <TechnologyBlock key={technology.technologyId} technology={technology} />
          ))}
        </VStack>
      </Box>

      {history && history.length > 0 && (
        <Box>
          <SectionLabel>Past interviews</SectionLabel>
          <VStack align="stretch" spacing={1}>
            {history.map((interview) => (
              <HStack
                key={interview.id}
                justify="space-between"
                px={3}
                py={2}
                borderRadius="md"
                _hover={{ bg: 'surface.100' }}
                cursor="pointer"
                onClick={() => navigate(`/interview/${interview.id}`)}
              >
                <HStack spacing={3}>
                  <Text fontSize="sm" color="ink.200">
                    {interview.mode}
                  </Text>
                  <Text fontSize="xs" color="ink.500">
                    {new Date(interview.startedAt).toLocaleDateString()} ·{' '}
                    {interview.questionCount} questions
                  </Text>
                </HStack>
                <Text fontSize="sm" color={interview.overallScore === null ? 'ink.500' : 'ink.200'}>
                  {interview.overallScore === null
                    ? interview.status === 'IN_PROGRESS'
                      ? 'unfinished'
                      : '—'
                    : `${Math.round(interview.overallScore * 100)}%`}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Box>
      )}
    </Box>
  );
}

function TechnologyBlock({ technology }: { technology: GuideTechnology }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? technology.topics : technology.topics.slice(0, 4);

  return (
    <Box>
      <HStack justify="space-between" mb={2}>
        <HStack spacing={2}>
          <Text fontSize="sm" fontWeight={600} color="ink.100">
            {technology.name}
          </Text>
          <Badge bg="surface.300" color="ink.400" fontSize="xs">
            {technology.interviewImportance}/5 for interviews
          </Badge>
        </HStack>
        <Text fontSize="sm" color="ink.300">
          {technology.readiness === null
            ? '—'
            : `${Math.round(technology.readiness * 100)}%`}
        </Text>
      </HStack>

      <VStack align="stretch" spacing={1}>
        {shown.map((topic) => (
          <HStack key={topic.conceptId} spacing={3} px={3} py={2} align="flex-start">
            <Badge
              bg="transparent"
              color={STATUS_COLOUR[topic.status]}
              borderWidth="1px"
              borderColor={STATUS_COLOUR[topic.status]}
              fontSize="xs"
              minW="70px"
              textAlign="center"
              flexShrink={0}
            >
              {STATUS_LABEL[topic.status]}
            </Badge>
            <Box flex="1" minW={0}>
              <Text fontSize="sm" color="ink.200">
                {topic.name}
              </Text>
              {topic.commonMistakes.length > 0 && topic.status !== 'STRONG' && (
                <Text fontSize="xs" color="ink.500" mt={0.5}>
                  Watch for: {topic.commonMistakes[0]}
                </Text>
              )}
            </Box>
          </HStack>
        ))}
      </VStack>

      {technology.topics.length > 4 && (
        <Button
          variant="ghost"
          size="xs"
          color="ink.500"
          mt={1}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : `${technology.topics.length - 4} more`}
        </Button>
      )}
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      fontSize="xs"
      textTransform="uppercase"
      letterSpacing="0.06em"
      color="ink.500"
      fontWeight={600}
      mb={3}
    >
      {children}
    </Text>
  );
}
