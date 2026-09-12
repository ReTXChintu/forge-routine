import { Badge, Box, Divider, HStack, Icon, Text, VStack } from '@chakra-ui/react';
import { FiAlertTriangle, FiCheck, FiX } from 'react-icons/fi';

import type { CodeEvaluation, ExecutionResult } from '@forgeroutine/shared-types';

/**
 * Execution results and the AI evaluation.
 *
 * Two rules from the product spec show up directly here:
 *  - Unscored quality dimensions render as "—", never as 0%. A dash is honest;
 *    a zero is a claim we did not earn.
 *  - The evaluation never offers to apply a fix. It says what is wrong and
 *    leaves the fixing to the user (§31).
 */

interface ResultsPanelProps {
  execution: ExecutionResult | null;
  evaluation: CodeEvaluation | null;
  hint: string | null;
  running: boolean;
}

export function ResultsPanel({ execution, evaluation, hint, running }: ResultsPanelProps) {
  if (running) {
    return (
      <Box p={4}>
        <Text fontSize="sm" color="ink.400">
          Running your code…
        </Text>
      </Box>
    );
  }

  if (!execution) {
    return (
      <Box p={4}>
        <Text fontSize="sm" color="ink.500">
          Run your code to see results.
        </Text>
      </Box>
    );
  }

  const isInfrastructureFailure =
    execution.status === 'HARNESS_ERROR' || execution.status === 'INTERNAL_ERROR';

  return (
    <VStack align="stretch" spacing={3} p={4} overflowY="auto" h="100%">
      <HStack justify="space-between">
        <HStack spacing={2}>
          <StatusBadge status={execution.status} />
          {execution.testsTotal > 0 && (
            <Text fontSize="sm" color="ink.300" fontFamily="mono">
              {execution.testsPassed}/{execution.testsTotal}
            </Text>
          )}
        </HStack>
        <Text fontSize="xs" color="ink.500" fontFamily="mono">
          {execution.durationMs}ms
        </Text>
      </HStack>

      {isInfrastructureFailure && (
        <Box bg="surface.200" borderLeftWidth="2px" borderColor="warn" p={3} borderRadius="md">
          <HStack spacing={2} mb={1}>
            <Icon as={FiAlertTriangle} color="warn" />
            <Text fontSize="sm" fontWeight={600}>
              This one is on us
            </Text>
          </HStack>
          <Text fontSize="xs" color="ink.300">
            The runner failed, not your code. This does not count against your progress.
          </Text>
        </Box>
      )}

      {execution.stderr && (
        <Box
          bg="surface.0"
          borderWidth="1px"
          borderColor="surface.300"
          borderRadius="md"
          p={3}
          fontFamily="mono"
          fontSize="xs"
          color="fail"
          whiteSpace="pre-wrap"
          maxH="160px"
          overflowY="auto"
        >
          {execution.stderr}
        </Box>
      )}

      {execution.cases.length > 0 && (
        <VStack align="stretch" spacing={1}>
          {execution.cases.map((testCase, index) => (
            <HStack
              key={`${testCase.name}-${index}`}
              spacing={2}
              align="flex-start"
              bg="surface.200"
              borderRadius="md"
              px={3}
              py={2}
            >
              <Icon
                as={testCase.passed ? FiCheck : FiX}
                color={testCase.passed ? 'pass' : 'fail'}
                mt="2px"
                flexShrink={0}
              />
              <Box flex="1" minW={0}>
                <Text fontSize="sm" color={testCase.passed ? 'ink.300' : 'ink.100'}>
                  {testCase.name}
                </Text>
                {!testCase.passed && testCase.error && (
                  <Text fontSize="xs" color="ink.400" fontFamily="mono" mt={1}>
                    {testCase.error}
                  </Text>
                )}
              </Box>
            </HStack>
          ))}
        </VStack>
      )}

      {execution.stdout && (
        <Box>
          <Text fontSize="xs" color="ink.500" mb={1} letterSpacing="0.06em">
            OUTPUT
          </Text>
          <Box
            bg="surface.0"
            borderWidth="1px"
            borderColor="surface.300"
            borderRadius="md"
            p={3}
            fontFamily="mono"
            fontSize="xs"
            color="ink.300"
            whiteSpace="pre-wrap"
            maxH="140px"
            overflowY="auto"
          >
            {execution.stdout}
            {execution.truncated && (
              <Text as="span" color="warn">
                {'\n'}…truncated
              </Text>
            )}
          </Box>
        </Box>
      )}

      {hint && (
        <Box bg="surface.200" borderLeftWidth="2px" borderColor="forge.500" p={3} borderRadius="md">
          <Text fontSize="sm" color="ink.200">
            {hint}
          </Text>
        </Box>
      )}

      {evaluation && <Evaluation evaluation={evaluation} />}
    </VStack>
  );
}

function Evaluation({ evaluation }: { evaluation: CodeEvaluation }) {
  const dimensions = [
    ['Correctness', evaluation.quality.correctness],
    ['Readability', evaluation.quality.readability],
    ['Architecture', evaluation.quality.architecture],
    ['Error handling', evaluation.quality.errorHandling],
    ['Edge cases', evaluation.quality.edgeCases],
    ['Performance', evaluation.quality.performance],
    ['Security', evaluation.quality.security],
    ['Idiomatic', evaluation.quality.idiomatic],
  ] as const;

  return (
    <>
      <Divider borderColor="surface.300" />

      <HStack justify="space-between">
        <Text fontSize="xs" fontWeight={700} color="ink.400" letterSpacing="0.06em">
          REVIEW
        </Text>
        {evaluation.degraded && (
          <Badge bg="surface.300" color="ink.400" fontSize="xs">
            tests only
          </Badge>
        )}
      </HStack>

      <Box>
        {dimensions.map(([label, value]) => (
          <HStack key={label} justify="space-between" py="3px">
            <Text fontSize="xs" color="ink.400">
              {label}
            </Text>
            {value === null ? (
              // Unscored. A dash, never a zero.
              <Text fontSize="xs" color="ink.500" fontFamily="mono">
                —
              </Text>
            ) : (
              <HStack spacing={2}>
                <Box w="64px" h="4px" bg="surface.300" borderRadius="full" overflow="hidden">
                  <Box
                    h="100%"
                    w={`${Math.round(value * 100)}%`}
                    bg={value >= 0.7 ? 'pass' : value >= 0.4 ? 'warn' : 'fail'}
                  />
                </Box>
                <Text fontSize="xs" color="ink.300" fontFamily="mono" w="32px" textAlign="right">
                  {Math.round(value * 100)}%
                </Text>
              </HStack>
            )}
          </HStack>
        ))}
      </Box>

      {evaluation.strengths.length > 0 && (
        <Box>
          <Text fontSize="xs" color="pass" mb={1} letterSpacing="0.04em">
            WORKING WELL
          </Text>
          {evaluation.strengths.map((item) => (
            <Text key={item} fontSize="sm" color="ink.300">
              • {item}
            </Text>
          ))}
        </Box>
      )}

      {evaluation.weaknesses.length > 0 && (
        <Box>
          <Text fontSize="xs" color="warn" mb={1} letterSpacing="0.04em">
            {evaluation.weaknesses.length} ISSUE{evaluation.weaknesses.length === 1 ? '' : 'S'}
          </Text>
          {evaluation.weaknesses.map((item) => (
            <Text key={item} fontSize="sm" color="ink.300">
              • {item}
            </Text>
          ))}
          {/* No "apply fix" button, by design. */}
          <Text fontSize="xs" color="ink.500" mt={2} fontStyle="italic">
            Fix these yourself — that is the part that sticks.
          </Text>
        </Box>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: ExecutionResult['status'] }) {
  const palette: Record<string, { bg: string; label: string }> = {
    PASSED: { bg: 'pass', label: 'PASSED' },
    FAILED: { bg: 'fail', label: 'FAILED' },
    COMPILE_ERROR: { bg: 'warn', label: 'WILL NOT LOAD' },
    RUNTIME_ERROR: { bg: 'fail', label: 'CRASHED' },
    TIMEOUT: { bg: 'warn', label: 'TIMED OUT' },
    MEMORY_EXCEEDED: { bg: 'warn', label: 'OUT OF MEMORY' },
    OUTPUT_EXCEEDED: { bg: 'warn', label: 'TOO MUCH OUTPUT' },
    HARNESS_ERROR: { bg: 'ink.500', label: 'RUNNER ERROR' },
    INTERNAL_ERROR: { bg: 'ink.500', label: 'RUNNER ERROR' },
  };

  const entry = palette[status] ?? { bg: 'ink.500', label: status };

  return (
    <Badge bg={entry.bg} color="surface.0" fontSize="xs" px={2} letterSpacing="0.04em">
      {entry.label}
    </Badge>
  );
}
