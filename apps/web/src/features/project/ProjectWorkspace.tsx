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
  VStack,
} from '@chakra-ui/react';
import Editor from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import { FiCheck, FiLock, FiX } from 'react-icons/fi';
import { useParams } from 'react-router-dom';

import {
  useProject,
  useStartProject,
  useSubmitProjectStep,
  type ProjectStepView,
  type ReviewIssue,
  type StepSubmissionResult,
} from '~/lib/queries';

/**
 * The project workspace (§14).
 *
 * Steps are shown as a spine on the left with only the current one open. A
 * locked step shows its title and nothing else: seeing step three's
 * requirements while working on step one gives away the shape of the answer,
 * and the server withholds them for the same reason.
 *
 * The review is the other half of the grade. Tests passing is necessary, not
 * sufficient — a finished project carrying critical or major issues sends the
 * user back with a specific list rather than waving them through.
 */
export function ProjectWorkspace() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const { data: project, isLoading } = useProject(exerciseId);
  const start = useStartProject();
  const submit = useSubmitProjectStep();

  const [code, setCode] = useState('');
  const [result, setResult] = useState<StepSubmissionResult | null>(null);

  const currentStep = project?.steps.find((step) => step.status === 'CURRENT');

  // Load the step's starter code once, when the step changes. Re-running on
  // every render would wipe out whatever the user has typed.
  useEffect(() => {
    if (currentStep) setCode(currentStep.starterCode ?? '');
    setResult(null);
  }, [currentStep?.index, currentStep?.starterCode]);

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!project) {
    return (
      <Box maxW="640px" mx="auto" px={6} py={20} textAlign="center">
        <Text fontSize="sm" color="ink.400">
          This project could not be loaded.
        </Text>
      </Box>
    );
  }

  const notStarted = !project.attemptId;
  const complete = project.steps.every((step) => step.status === 'DONE');

  const run = async () => {
    if (!project.attemptId || !exerciseId) return;
    const outcome = await submit.mutateAsync({
      exerciseId,
      attemptId: project.attemptId,
      code,
    });
    setResult(outcome);
  };

  return (
    <Grid templateColumns={{ base: '1fr', lg: '280px 1fr 380px' }} h="100%" minH={0}>
      {/* Step spine */}
      <GridItem
        borderRightWidth="1px"
        borderColor="surface.300"
        bg="surface.50"
        overflowY="auto"
        p={5}
        display={{ base: 'none', lg: 'block' }}
      >
        <Badge bg="forge.500" color="surface.0" fontSize="xs" mb={2}>
          Project
        </Badge>
        <Heading size="sm" color="ink.100" mb={2} lineHeight="1.4">
          {project.title}
        </Heading>
        <Text fontSize="xs" color="ink.400" mb={6} lineHeight="1.6">
          {project.objective}
        </Text>

        <VStack align="stretch" spacing={1}>
          {project.steps.map((step) => (
            <StepRow key={step.index} step={step} />
          ))}
        </VStack>
      </GridItem>

      {/* Editor */}
      <GridItem display="flex" flexDirection="column" minH={0} minW={0}>
        <HStack
          justify="space-between"
          px={5}
          py={3}
          borderBottomWidth="1px"
          borderColor="surface.300"
          flexShrink={0}
        >
          <Box minW={0}>
            <Text fontSize="sm" fontWeight={600} color="ink.100" noOfLines={1}>
              {complete
                ? 'Project complete'
                : `Step ${(currentStep?.index ?? 0) + 1} · ${currentStep?.title ?? ''}`}
            </Text>
            {currentStep && !complete && (
              <Text fontSize="xs" color="ink.500">
                ~{currentStep.estimatedMinutes} min
              </Text>
            )}
          </Box>

          {notStarted ? (
            <Button
              size="sm"
              onClick={() => exerciseId && start.mutate(exerciseId)}
              isLoading={start.isPending}
            >
              Start project
            </Button>
          ) : (
            !complete && (
              <Button
                size="sm"
                onClick={() => void run()}
                isLoading={submit.isPending}
                loadingText="Running"
                isDisabled={code.trim().length === 0}
              >
                Submit step
              </Button>
            )
          )}
        </HStack>

        <Box flex="1" minH={0}>
          <Editor
            height="100%"
            language={project.language}
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value ?? '')}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
              fontLigatures: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 16 },
              readOnly: notStarted || complete,
              tabSize: 2,
              renderWhitespace: 'selection',
            }}
          />
        </Box>
      </GridItem>

      {/* Requirements, results and review */}
      <GridItem
        borderLeftWidth="1px"
        borderColor="surface.300"
        bg="surface.50"
        overflowY="auto"
        p={5}
        minW={0}
      >
        {currentStep && !complete && (
          <Box mb={6}>
            <SectionLabel>What this step needs</SectionLabel>
            <Text fontSize="sm" color="ink.200" whiteSpace="pre-wrap" lineHeight="1.7">
              {currentStep.requirements}
            </Text>

            {currentStep.visibleTestNames.length > 0 && (
              <Box mt={4}>
                <SectionLabel>Checks</SectionLabel>
                <VStack align="stretch" spacing={1}>
                  {currentStep.visibleTestNames.map((name) => (
                    <Text key={name} fontSize="xs" color="ink.400" fontFamily="mono">
                      {name}
                    </Text>
                  ))}
                </VStack>
              </Box>
            )}
          </Box>
        )}

        {result && <StepResult result={result} />}

        {complete && !result && (
          <Box textAlign="center" py={10}>
            <Box as={FiCheck} color="pass" fontSize="2xl" mx="auto" mb={2} />
            <Text fontSize="sm" color="ink.200">
              Every step passed, review included.
            </Text>
          </Box>
        )}
      </GridItem>
    </Grid>
  );
}

function StepRow({ step }: { step: ProjectStepView }) {
  const colour =
    step.status === 'DONE' ? 'pass' : step.status === 'CURRENT' ? 'forge.500' : 'ink.500';

  return (
    <HStack
      spacing={3}
      px={3}
      py={2.5}
      borderRadius="md"
      bg={step.status === 'CURRENT' ? 'surface.200' : 'transparent'}
      align="flex-start"
    >
      <Box flexShrink={0} mt="2px" color={colour} fontSize="sm">
        {step.status === 'DONE' ? (
          <FiCheck />
        ) : step.status === 'LOCKED' ? (
          <FiLock />
        ) : (
          <Box w="14px" h="14px" borderRadius="full" borderWidth="2px" borderColor="forge.500" />
        )}
      </Box>
      <Box minW={0}>
        <Text
          fontSize="sm"
          color={step.status === 'LOCKED' ? 'ink.500' : 'ink.200'}
          fontWeight={step.status === 'CURRENT' ? 600 : 400}
        >
          {step.index + 1}. {step.title}
        </Text>
      </Box>
    </HStack>
  );
}

function StepResult({ result }: { result: StepSubmissionResult }) {
  return (
    <Box>
      <SectionLabel>Tests</SectionLabel>
      <HStack mb={3} spacing={2}>
        <Text fontSize="sm" fontWeight={600} color={result.passed ? 'pass' : 'fail'}>
          {result.testsPassed}/{result.testsTotal} passing
        </Text>
      </HStack>

      <VStack align="stretch" spacing={1.5} mb={6}>
        {result.cases.map((testCase) => (
          <Box key={testCase.name}>
            <HStack spacing={2} align="flex-start">
              <Box
                as={testCase.passed ? FiCheck : FiX}
                color={testCase.passed ? 'pass' : 'fail'}
                fontSize="sm"
                flexShrink={0}
                mt="2px"
              />
              <Text fontSize="xs" color="ink.300" fontFamily="mono">
                {testCase.name}
              </Text>
            </HStack>
            {testCase.error && (
              <Text fontSize="xs" color="fail" fontFamily="mono" pl={6} mt={1} whiteSpace="pre-wrap">
                {testCase.error}
              </Text>
            )}
          </Box>
        ))}
      </VStack>

      {result.checkpointFailed && (
        <Box borderWidth="1px" borderColor="warn" borderRadius="md" p={3} mb={5} bg="surface.100">
          <Text fontSize="sm" color="warn" fontWeight={600} mb={1}>
            Tests pass, but this is not finished
          </Text>
          <Text fontSize="xs" color="ink.300" lineHeight="1.6">
            The review below found problems serious enough that shipping this would be a
            mistake. Fix them and resubmit.
          </Text>
        </Box>
      )}

      {result.review && (
        <Box>
          <SectionLabel>Review</SectionLabel>
          <Text fontSize="sm" color="ink.200" lineHeight="1.7" mb={4}>
            {result.review.summary}
          </Text>

          <VStack align="stretch" spacing={3}>
            {result.review.issues.map((issue) => (
              <ReviewIssueCard key={issue.title} issue={issue} />
            ))}
          </VStack>
        </Box>
      )}

      {result.projectComplete && (
        <Box mt={6} pt={5} borderTopWidth="1px" borderColor="surface.300">
          <Text fontSize="sm" color="pass" fontWeight={600}>
            Project complete.
          </Text>
          <Text fontSize="xs" color="ink.400" mt={1} lineHeight="1.6">
            This is the only work that shows whether you can compose several ideas at once, so
            it counts for more than the drills did.
          </Text>
        </Box>
      )}
    </Box>
  );
}

const SEVERITY_COLOUR: Record<ReviewIssue['severity'], string> = {
  critical: 'fail',
  major: 'warn',
  minor: 'ink.300',
  nit: 'ink.500',
};

function ReviewIssueCard({ issue }: { issue: ReviewIssue }) {
  return (
    <Box borderLeftWidth="2px" borderColor={SEVERITY_COLOUR[issue.severity]} pl={3}>
      <HStack spacing={2} mb={1}>
        <Text
          fontSize="xs"
          textTransform="uppercase"
          letterSpacing="0.04em"
          color={SEVERITY_COLOUR[issue.severity]}
          fontWeight={600}
        >
          {issue.severity}
        </Text>
        <Text fontSize="xs" color="ink.500">
          {issue.category}
          {issue.line !== null && ` · line ${issue.line}`}
        </Text>
      </HStack>
      <Text fontSize="sm" color="ink.100" fontWeight={500} mb={1}>
        {issue.title}
      </Text>
      <Text fontSize="xs" color="ink.300" lineHeight="1.6">
        {issue.explanation}
      </Text>
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
      mb={2}
    >
      {children}
    </Text>
  );
}
