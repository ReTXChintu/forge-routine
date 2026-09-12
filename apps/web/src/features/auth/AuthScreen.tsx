import {
  Alert,
  AlertIcon,
  Box,
  Button,
  FormControl,
  FormErrorMessage,
  FormLabel,
  HStack,
  Image,
  Input,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '~/lib/api';
import { useLogin, useRegister } from '~/lib/queries';

import fullLogo from '../../../../../assets/brand/full-logo-480.png';

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  const login = useLogin();
  const register = useRegister();
  const navigate = useNavigate();

  const pending = login.isPending || register.isPending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      if (mode === 'login') {
        await login.mutateAsync({ email, password });
      } else {
        await register.mutateAsync({ email, password, displayName });
      }
      navigate('/', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) setError(caught);
      else throw caught;
    }
  };

  const fieldError = (field: string): string | undefined => error?.fieldErrors[field]?.[0];

  return (
    <Box minH="100vh" bg="surface.0" display="flex" alignItems="center" justifyContent="center" px={4}>
      <Box w="100%" maxW="380px">
        <Image src={fullLogo} alt="ForgeRoutine" maxW="260px" mx="auto" mb={2} />
        <Text textAlign="center" fontSize="sm" color="ink.400" mb={8}>
          Forge your coding skills. Build your engineering mind.
        </Text>

        <Box
          as="form"
          onSubmit={submit}
          bg="surface.100"
          borderWidth="1px"
          borderColor="surface.300"
          borderRadius="lg"
          p={6}
        >
          <VStack align="stretch" spacing={4}>
            {error && !error.problem.errors && (
              <Alert status="error" bg="surface.200" fontSize="sm" borderRadius="md">
                <AlertIcon color="fail" />
                {error.message}
              </Alert>
            )}

            {mode === 'register' && (
              <FormControl isInvalid={Boolean(fieldError('displayName'))}>
                <FormLabel fontSize="xs" color="ink.400">
                  Name
                </FormLabel>
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                />
                <FormErrorMessage fontSize="xs">{fieldError('displayName')}</FormErrorMessage>
              </FormControl>
            )}

            <FormControl isInvalid={Boolean(fieldError('email'))}>
              <FormLabel fontSize="xs" color="ink.400">
                Email
              </FormLabel>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
              />
              <FormErrorMessage fontSize="xs">{fieldError('email')}</FormErrorMessage>
            </FormControl>

            <FormControl isInvalid={Boolean(fieldError('password'))}>
              <FormLabel fontSize="xs" color="ink.400">
                Password
              </FormLabel>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <FormErrorMessage fontSize="xs">{fieldError('password')}</FormErrorMessage>
              {mode === 'register' && !fieldError('password') && (
                <Text fontSize="xs" color="ink.500" mt={1}>
                  At least 12 characters.
                </Text>
              )}
            </FormControl>

            <Button type="submit" isLoading={pending} w="100%">
              {mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>

            <HStack justify="center" spacing={1} pt={1}>
              <Text fontSize="xs" color="ink.500">
                {mode === 'login' ? 'No account?' : 'Already have one?'}
              </Text>
              <Button
                variant="ghost"
                size="xs"
                color="forge.500"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setError(null);
                }}
              >
                {mode === 'login' ? 'Create one' : 'Sign in'}
              </Button>
            </HStack>
          </VStack>
        </Box>
      </Box>
    </Box>
  );
}
