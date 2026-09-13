import {
  Box,
  Button,
  Grid,
  HStack,
  Heading,
  Image,
  Input,
  Progress,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useMemo, useState } from 'react';
import { FiCheck } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

import { useCatalogue, useCompleteOnboarding } from '~/lib/queries';

import fullLogo from '../../../../../assets/brand/full-logo-480.png';

/**
 * The first-run flow (docs/learning-path.md).
 *
 * Four questions, each narrowing the next. Every one after the first has a
 * sane default and can be skipped: a user who abandons onboarding still gets
 * a usable product, just a generic path.
 */

type Step = 0 | 1 | 2 | 3;

/**
 * Four buckets, not a slider. Precise self-assessment is exactly the thing
 * this product distrusts, and a slider invites false precision.
 */
const KNOWLEDGE_LEVELS = [
  { value: 0, label: 'New to it', hint: 'Start from the beginning' },
  { value: 0.25, label: 'Some basics', hint: 'I have touched it' },
  { value: 0.55, label: 'Working knowledge', hint: 'I use it, with gaps' },
  { value: 0.8, label: 'Strong', hint: 'Just keep me sharp' },
] as const;

const GOALS = [
  { value: 'CODING', label: 'Write code unaided', hint: 'Rebuild the muscle' },
  { value: 'INTERVIEW', label: 'Pass an interview', hint: 'There is a date' },
  { value: 'JOB_PREPARATION', label: 'Find a job', hint: 'Interviews, plural' },
  { value: 'ENGINEERING_MASTERY', label: 'Go deeper', hint: 'No deadline' },
] as const;

const TIMES = [30, 45, 60, 90, 120] as const;

interface Selection {
  technologyId: string;
  name: string;
  existingKnowledge: number;
  interviewImportance: number;
}

export function Onboarding() {
  const [step, setStep] = useState<Step>(0);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection[]>([]);
  const [dailyMinutes, setDailyMinutes] = useState<number>(45);
  const [primaryGoal, setPrimaryGoal] = useState<(typeof GOALS)[number]['value']>('CODING');
  const [interviewDate, setInterviewDate] = useState('');

  const { data: catalogue } = useCatalogue(search);
  const completeOnboarding = useCompleteOnboarding();
  const navigate = useNavigate();

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.technologyId)), [selected]);

  const toggle = (id: string, name: string) => {
    setSelected((current) =>
      current.some((s) => s.technologyId === id)
        ? current.filter((s) => s.technologyId !== id)
        : [...current, { technologyId: id, name, existingKnowledge: 0, interviewImportance: 3 }],
    );
  };

  const setKnowledge = (id: string, value: number) => {
    setSelected((current) =>
      current.map((s) => (s.technologyId === id ? { ...s, existingKnowledge: value } : s)),
    );
  };

  const finish = async () => {
    const interviewShaped = primaryGoal === 'INTERVIEW' || primaryGoal === 'JOB_PREPARATION';

    await completeOnboarding.mutateAsync({
      technologies: selected.map((s) => ({
        technologyId: s.technologyId,
        existingKnowledge: s.existingKnowledge,
        // An interview goal raises importance across the board; the roadmap
        // builder uses it to decide where interview checkpoints land.
        interviewImportance: interviewShaped ? 4 : 3,
      })),
      dailyMinutes,
      primaryGoal,
      interviewTarget: 'MID',
      interviewDate: interviewDate || null,
    });

    navigate('/roadmap', { replace: true });
  };

  const canContinue = step === 0 ? selected.length > 0 : true;

  return (
    <Box minH="100vh" bg="surface.0" display="flex" flexDirection="column">
      {/* Full-bleed header and progress bar, per the prototype's setup
          shell. The form inside stays readable at 560px — a question with
          four options does not get better at 1600px wide — but the chrome
          around it uses the whole screen. */}
      <Box
        px={10}
        py={5}
        borderBottomWidth="1px"
        borderColor="surface.300"
        display="flex"
        alignItems="center"
        justifyContent="space-between"
      >
        <Image src={fullLogo} alt="ForgeRoutine" maxW="150px" />
        <Text fontSize="xs" color="ink.500">
          Step {step + 1} of 4
        </Text>
      </Box>

      <Progress
        value={((step + 1) / 4) * 100}
        size="xs"
        borderRadius={0}
        sx={{ '& > div': { bg: 'forge.500' } }}
      />

      <Box flex="1" overflowY="auto" px={10} py={12} display="flex" justifyContent="center">
        <Box maxW="560px" w="100%">
          {step === 0 && (
            <StepShell
              title="What do you want to get better at?"
              subtitle="Pick as many as you like. You can add more at any time."
            >
              <Input
                placeholder="Search technologies…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                mb={4}
              />

              <Grid templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)' }} gap={2}>
                {(catalogue ?? []).map((technology) => {
                  const isSelected = selectedIds.has(technology.id);
                  return (
                    <Button
                      key={technology.id}
                      variant="outline"
                      justifyContent="flex-start"
                      h="auto"
                      py={3}
                      px={3}
                      borderColor={isSelected ? 'forge.500' : 'surface.400'}
                      bg={isSelected ? 'surface.200' : 'transparent'}
                      onClick={() => toggle(technology.id, technology.name)}
                    >
                      <HStack w="100%" spacing={3}>
                        <Box
                          w="16px"
                          h="16px"
                          borderRadius="sm"
                          borderWidth="1px"
                          borderColor={isSelected ? 'forge.500' : 'surface.400'}
                          bg={isSelected ? 'forge.500' : 'transparent'}
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          flexShrink={0}
                        >
                          {isSelected && <FiCheck size={11} color="#0B0C0E" />}
                        </Box>
                        <Box textAlign="left" minW={0}>
                          <Text fontSize="sm" color="ink.100" noOfLines={1}>
                            {technology.name}
                          </Text>
                          <Text fontSize="xs" color="ink.500" fontWeight={400}>
                            {technology.category}
                          </Text>
                        </Box>
                      </HStack>
                    </Button>
                  );
                })}
              </Grid>
            </StepShell>
          )}

          {step === 1 && (
            <StepShell
              title="Where are you now?"
              subtitle="Roughly is fine. This stops you being taught things you already know."
            >
              <VStack align="stretch" spacing={5}>
                {selected.map((technology) => (
                  <Box key={technology.technologyId}>
                    <Text fontSize="sm" color="ink.100" mb={2} fontWeight={600}>
                      {technology.name}
                    </Text>
                    <Grid templateColumns={{ base: '1fr 1fr', md: 'repeat(4, 1fr)' }} gap={2}>
                      {KNOWLEDGE_LEVELS.map((level) => (
                        <Button
                          key={level.value}
                          size="sm"
                          variant="outline"
                          h="auto"
                          py={2}
                          borderColor={
                            technology.existingKnowledge === level.value
                              ? 'forge.500'
                              : 'surface.400'
                          }
                          onClick={() => setKnowledge(technology.technologyId, level.value)}
                        >
                          <Box textAlign="left" w="100%">
                            <Text fontSize="xs" color="ink.200">
                              {level.label}
                            </Text>
                            <Text fontSize="xs" color="ink.500" fontWeight={400}>
                              {level.hint}
                            </Text>
                          </Box>
                        </Button>
                      ))}
                    </Grid>
                  </Box>
                ))}
              </VStack>
            </StepShell>
          )}

          {step === 2 && (
            <StepShell
              title="How much time per day?"
              subtitle="Be honest rather than ambitious. A plan you skip is worse than a small one you keep."
            >
              <Grid templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(5, 1fr)' }} gap={2}>
                {TIMES.map((minutes) => (
                  <Button
                    key={minutes}
                    variant="outline"
                    h="auto"
                    py={4}
                    borderColor={dailyMinutes === minutes ? 'forge.500' : 'surface.400'}
                    onClick={() => setDailyMinutes(minutes)}
                  >
                    <Box>
                      <Text fontSize="lg" color="ink.100" fontFamily="mono">
                        {minutes}
                      </Text>
                      <Text fontSize="xs" color="ink.500" fontWeight={400}>
                        min
                      </Text>
                    </Box>
                  </Button>
                ))}
              </Grid>
            </StepShell>
          )}

          {step === 3 && (
            <StepShell title="What is this for?" subtitle="This changes the order of everything.">
              <VStack align="stretch" spacing={2}>
                {GOALS.map((goal) => (
                  <Button
                    key={goal.value}
                    variant="outline"
                    justifyContent="flex-start"
                    h="auto"
                    py={3}
                    borderColor={primaryGoal === goal.value ? 'forge.500' : 'surface.400'}
                    onClick={() => setPrimaryGoal(goal.value)}
                  >
                    <Box textAlign="left">
                      <Text fontSize="sm" color="ink.100">
                        {goal.label}
                      </Text>
                      <Text fontSize="xs" color="ink.500" fontWeight={400}>
                        {goal.hint}
                      </Text>
                    </Box>
                  </Button>
                ))}

                {(primaryGoal === 'INTERVIEW' || primaryGoal === 'JOB_PREPARATION') && (
                  <Box pt={3}>
                    <Text fontSize="xs" color="ink.400" mb={1}>
                      Interview date, if you have one
                    </Text>
                    <Input
                      type="date"
                      value={interviewDate}
                      onChange={(event) => setInterviewDate(event.target.value)}
                      maxW="200px"
                    />
                  </Box>
                )}
              </VStack>
            </StepShell>
          )}

          <HStack justify="space-between" mt={8}>
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1) as Step)}
              isDisabled={step === 0}
            >
              Back
            </Button>

            <HStack spacing={2}>
              <Text fontSize="xs" color="ink.500">
                {step + 1} of 4
              </Text>
              {step < 3 ? (
                <Button
                  onClick={() => setStep((s) => Math.min(3, s + 1) as Step)}
                  isDisabled={!canContinue}
                >
                  Continue
                </Button>
              ) : (
                <Button onClick={() => void finish()} isLoading={completeOnboarding.isPending}>
                  Build my roadmap
                </Button>
              )}
            </HStack>
          </HStack>
        </Box>
      </Box>
    </Box>
  );
}

function StepShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Box>
      <Heading size="md" mb={1} fontWeight={650}>
        {title}
      </Heading>
      <Text fontSize="sm" color="ink.400" mb={6}>
        {subtitle}
      </Text>
      {children}
    </Box>
  );
}
