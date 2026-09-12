import { Box, Button, HStack, Text, Textarea, VStack } from '@chakra-ui/react';

import type { DiagnosisResult } from '@forgeroutine/shared-types';

/**
 * Diagnose-before-fix, for DEBUGGING exercises (§13).
 *
 * The user must commit to a written explanation before submitting. It is not
 * busywork: repairing code by shuffling it until the tests pass is exactly the
 * habit this product exists to break, and a diagnosis makes that impossible to
 * do accidentally.
 *
 * Grading is separate from the fix, so a correct patch with a wrong diagnosis
 * still says something true about the user's debugging ability.
 */

interface DiagnosisPanelProps {
  value: string;
  onChange: (value: string) => void;
  result: DiagnosisResult | null;
  submitted: boolean;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
}

export function DiagnosisPanel({
  value,
  onChange,
  result,
  submitted,
  onSubmit,
  submitting,
  canSubmit,
}: DiagnosisPanelProps) {
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  const longEnough = wordCount >= 5;

  return (
    <VStack align="stretch" spacing={3} p={4} overflowY="auto" h="100%">
      <Box>
        <Text fontSize="xs" fontWeight={700} color="ink.400" letterSpacing="0.06em">
          DIAGNOSIS
        </Text>
        <Text fontSize="xs" color="ink.500" mt={1}>
          What is wrong, and why does it produce this behaviour? Write it before you fix anything.
        </Text>
      </Box>

      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="The loop variable is declared with…"
        rows={6}
        bg="surface.200"
        borderColor="surface.300"
        fontSize="sm"
        resize="vertical"
        isDisabled={submitted}
        _hover={{ borderColor: 'surface.400' }}
        _focusVisible={{ borderColor: 'forge.500' }}
      />

      <HStack justify="space-between">
        <Text fontSize="xs" color={longEnough ? 'ink.500' : 'warn'}>
          {longEnough ? `${wordCount} words` : 'Describe the cause, not the symptom'}
        </Text>
        {!submitted && (
          <Button
            size="xs"
            onClick={onSubmit}
            isDisabled={!longEnough || !canSubmit}
            isLoading={submitting}
          >
            Submit diagnosis and fix
          </Button>
        )}
      </HStack>

      {result && (
        <Box
          bg="surface.200"
          borderLeftWidth="2px"
          borderColor={accentFor(result.accuracy)}
          borderRadius="md"
          p={3}
        >
          <HStack justify="space-between" mb={2}>
            <Text fontSize="xs" color="ink.400" letterSpacing="0.04em">
              DIAGNOSIS
            </Text>
            <Text fontSize="xs" fontFamily="mono" color={accentFor(result.accuracy)}>
              {/* Unscored renders as a dash. We genuinely could not tell. */}
              {result.accuracy === null ? '—' : `${Math.round(result.accuracy * 100)}%`}
            </Text>
          </HStack>

          <Text fontSize="sm" color="ink.200" whiteSpace="pre-wrap">
            {result.feedback}
          </Text>

          {result.actualCause && (
            <Box mt={3} pt={3} borderTopWidth="1px" borderColor="surface.300">
              <Text fontSize="xs" color="ink.500" letterSpacing="0.04em" mb={1}>
                WHAT WAS ACTUALLY WRONG
              </Text>
              <Text fontSize="sm" color="ink.300">
                {result.actualCause}
              </Text>
            </Box>
          )}
        </Box>
      )}
    </VStack>
  );
}

function accentFor(accuracy: number | null): string {
  if (accuracy === null) return 'ink.500';
  if (accuracy >= 0.7) return 'pass';
  if (accuracy >= 0.4) return 'warn';
  return 'fail';
}
