import {
  Badge,
  Box,
  Button,
  Grid,
  GridItem,
  HStack,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  Tooltip,
  VStack,
} from '@chakra-ui/react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { AssistanceLevelName } from '@forgeroutine/shared-types';
import type {
  CodeEvaluation,
  ExecutionResult,
  ExerciseView,
  HintKind,
} from '@forgeroutine/shared-types';

import { ApiError } from '~/lib/api';
import {
  useExercise,
  useMarkFirstCode,
  useRequestHint,
  useStartAttempt,
  useSubmitCode,
} from '~/lib/queries';

import { AssistancePanel, type HintEntry } from './AssistancePanel';
import { ResultsPanel } from './ResultsPanel';

/**
 * The primary coding environment (§3).
 *
 * Layout: problem on the left, editor in the middle, results and assistance on
 * the right. The editor is the largest thing on screen because writing code is
 * the activity this product exists to restore.
 */
export function ExerciseWorkspace() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const { data: exercise, isLoading } = useExercise(exerciseId);

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [servedExercise, setServedExercise] = useState<ExerciseView | null>(null);
  const [code, setCode] = useState('');
  const [execution, setExecution] = useState<ExecutionResult | null>(null);
  const [evaluation, setEvaluation] = useState<CodeEvaluation | null>(null);
  const [nextHint, setNextHint] = useState<string | null>(null);
  const [hints, setHints] = useState<HintEntry[]>([]);
  const [pendingHint, setPendingHint] = useState<HintKind | null>(null);
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [blindMode, setBlindMode] = useState(false);

  // Advisory signals only. They never reach the Independent Coding Score —
  // the server counts what matters.
  const signals = useRef({ keystrokeCount: 0, largePasteEvents: 0 });
  const firstCodeSent = useRef(false);

  const startAttempt = useStartAttempt();
  const markFirstCode = useMarkFirstCode();
  const submitCode = useSubmitCode();
  const requestHint = useRequestHint();

  const view = servedExercise ?? exercise ?? null;

  const begin = useCallback(
    async (blind: boolean) => {
      if (!exerciseId) return;

      const result = await startAttempt.mutateAsync({ exerciseId, blindMode: blind });
      setAttemptId(result.attemptId);
      setServedExercise(result.exercise);
      setBlindMode(blind);
      setCode(result.exercise.starterCode ?? '');
      setExecution(null);
      setEvaluation(null);
      setHints([]);
      setNextHint(null);
      firstCodeSent.current = false;
      signals.current = { keystrokeCount: 0, largePasteEvents: 0 };
    },
    [exerciseId, startAttempt],
  );

  const handleEditorMount: OnMount = (editor) => {
    editor.onDidPaste((event) => {
      const pasted = editor.getModel()?.getValueInRange(event.range) ?? '';
      // Advisory. This triggers a question, never an accusation.
      if (pasted.length > 120) signals.current.largePasteEvents += 1;
    });
  };

  const handleChange = (value: string | undefined) => {
    setCode(value ?? '');
    signals.current.keystrokeCount += 1;

    // Time-to-first-code is recorded once, server-side, on the first real edit.
    if (!firstCodeSent.current && attemptId && (value ?? '').trim().length > 0) {
      firstCodeSent.current = true;
      markFirstCode.mutate(attemptId);
    }
  };

  const handleSubmit = async () => {
    if (!attemptId || !view) return;

    const result = await submitCode.mutateAsync({
      attemptId,
      code,
      language: view.language,
      clientSignals: { ...signals.current },
    });

    setExecution(result.execution);
    setEvaluation(result.evaluation);
    setNextHint(result.nextActionHint);
  };

  const handleHint = async (kind: HintKind, overrideGate = false) => {
    if (!attemptId) return;

    setPendingHint(kind);
    setGateMessage(null);

    try {
      const result = await requestHint.mutateAsync({
        attemptId,
        kind,
        code,
        ...(execution?.stderr ? { lastError: execution.stderr } : {}),
        overrideGate,
      });

      setHints((current) => [
        ...current,
        { kind, message: result.hint.response, intervention: result.intervention },
      ]);
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'assistance-gated') {
        setGateMessage(error.message);
      } else {
        throw error;
      }
    } finally {
      setPendingHint(null);
    }
  };

  // Ctrl/Cmd+Enter runs the code — the shortcut every developer already knows.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!view) {
    return (
      <Box p={8}>
        <Text color="ink.400">Exercise not found.</Text>
      </Box>
    );
  }

  return (
    <Grid
      templateColumns={{ base: '1fr', lg: '320px 1fr 380px' }}
      templateRows={{ base: 'auto', lg: '1fr' }}
      h="100%"
      gap={0}
    >
      {/* Problem */}
      <GridItem borderRightWidth="1px" borderColor="surface.300" overflowY="auto">
        <VStack align="stretch" spacing={4} p={5}>
          <Box>
            <HStack spacing={2} mb={2}>
              <Badge bg="surface.300" color="ink.300" fontSize="xs">
                Level {view.assistanceLevel} · {AssistanceLevelName[view.assistanceLevel]}
              </Badge>
              {blindMode && (
                <Badge bg="forge.700" color="forge.100" fontSize="xs">
                  BLIND
                </Badge>
              )}
            </HStack>
            <Text fontSize="xl" fontWeight={650} letterSpacing="-0.015em">
              {view.title}
            </Text>
          </Box>

          <Box bg="surface.100" borderLeftWidth="2px" borderColor="forge.500" p={3}>
            <Text fontSize="sm" color="ink.100">
              {view.objective}
            </Text>
          </Box>

          {view.requirements && (
            <Box>
              <Text fontSize="xs" color="ink.500" mb={1} letterSpacing="0.06em">
                REQUIREMENTS
              </Text>
              <Text fontSize="sm" color="ink.300" whiteSpace="pre-wrap">
                {view.requirements}
              </Text>
            </Box>
          )}

          {view.functionSignature && (
            <Box>
              <Text fontSize="xs" color="ink.500" mb={1} letterSpacing="0.06em">
                SIGNATURE
              </Text>
              <Box
                bg="surface.0"
                borderWidth="1px"
                borderColor="surface.300"
                borderRadius="md"
                p={2}
                fontFamily="mono"
                fontSize="xs"
                color="ink.200"
              >
                {view.functionSignature}
              </Box>
            </Box>
          )}

          {view.examples.length > 0 && (
            <Box>
              <Text fontSize="xs" color="ink.500" mb={1} letterSpacing="0.06em">
                EXAMPLES
              </Text>
              {view.examples.map((example) => (
                <Box
                  key={example}
                  bg="surface.0"
                  borderWidth="1px"
                  borderColor="surface.300"
                  borderRadius="md"
                  p={2}
                  mb={2}
                  fontFamily="mono"
                  fontSize="xs"
                  color="ink.300"
                  whiteSpace="pre-wrap"
                >
                  {example}
                </Box>
              ))}
            </Box>
          )}

          {view.visibleTestNames.length > 0 && (
            <Box>
              <Text fontSize="xs" color="ink.500" mb={1} letterSpacing="0.06em">
                TESTS
              </Text>
              {view.visibleTestNames.map((name) => (
                <Text key={name} fontSize="sm" color="ink.400">
                  • {name}
                </Text>
              ))}
            </Box>
          )}

          {!attemptId && (
            <VStack align="stretch" spacing={2} pt={2}>
              <Button onClick={() => void begin(false)} isLoading={startAttempt.isPending}>
                Start
              </Button>
              <Tooltip
                label="No AI, no hints, no solution. Evaluated only after you submit."
                placement="top"
              >
                <Button
                  variant="outline"
                  onClick={() => void begin(true)}
                  isLoading={startAttempt.isPending}
                >
                  Blind coding
                </Button>
              </Tooltip>
            </VStack>
          )}
        </VStack>
      </GridItem>

      {/* Editor */}
      <GridItem display="flex" flexDirection="column" minW={0} minH="480px">
        <HStack
          justify="space-between"
          px={4}
          py={2}
          borderBottomWidth="1px"
          borderColor="surface.300"
          bg="surface.50"
        >
          <Text fontSize="xs" color="ink.500" fontFamily="mono">
            solution.{view.language === 'typescript' ? 'ts' : 'js'}
          </Text>
          <HStack spacing={2}>
            <Text fontSize="xs" color="ink.500">
              ⌘↵
            </Text>
            <Button
              onClick={() => void handleSubmit()}
              isDisabled={!attemptId || code.trim().length === 0}
              isLoading={submitCode.isPending}
            >
              Run tests
            </Button>
          </HStack>
        </HStack>

        <Box flex="1" minH={0}>
          <Editor
            height="100%"
            language={view.language}
            theme="vs-dark"
            value={code}
            onChange={handleChange}
            onMount={handleEditorMount}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
              fontLigatures: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 16 },
              readOnly: !attemptId,
              tabSize: 2,
              renderWhitespace: 'selection',
              // Suggestions are suppressed in Blind Coding: autocomplete is
              // assistance, and §12 says there is none.
              quickSuggestions: !blindMode,
              suggestOnTriggerCharacters: !blindMode,
              wordBasedSuggestions: blindMode ? 'off' : 'currentDocument',
              parameterHints: { enabled: !blindMode },
            }}
          />
        </Box>
      </GridItem>

      {/* Results and assistance */}
      <GridItem borderLeftWidth="1px" borderColor="surface.300" minW={0} display="flex">
        <Tabs
          variant="unstyled"
          display="flex"
          flexDirection="column"
          w="100%"
          isFitted
        >
          <TabList borderBottomWidth="1px" borderColor="surface.300" bg="surface.50">
            <Tab
              fontSize="xs"
              py={2}
              color="ink.400"
              _selected={{ color: 'forge.500', borderBottomWidth: '2px', borderColor: 'forge.500' }}
            >
              RESULTS
            </Tab>
            <Tab
              fontSize="xs"
              py={2}
              color="ink.400"
              _selected={{ color: 'forge.500', borderBottomWidth: '2px', borderColor: 'forge.500' }}
            >
              ASSISTANCE
            </Tab>
          </TabList>
          <TabPanels flex="1" minH={0} overflow="hidden">
            <TabPanel p={0} h="100%">
              <ResultsPanel
                execution={execution}
                evaluation={evaluation}
                hint={nextHint}
                running={submitCode.isPending}
              />
            </TabPanel>
            <TabPanel p={0} h="100%">
              <AssistancePanel
                enabled={view.aiAssistanceEnabled && attemptId !== null}
                blindMode={blindMode}
                hints={hints}
                pending={pendingHint}
                gateMessage={gateMessage}
                onRequest={(kind, override) => void handleHint(kind, override)}
              />
            </TabPanel>
          </TabPanels>
        </Tabs>
      </GridItem>
    </Grid>
  );
}
