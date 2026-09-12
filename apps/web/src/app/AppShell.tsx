import { Box, Button, Flex, HStack, Image, Kbd, Text } from '@chakra-ui/react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';

import { CommandPalette } from '~/components/CommandPalette';
import { tokenStore } from '~/lib/api';

import appIcon from '../../../../assets/brand/app-icon-64.png';

/**
 * Application chrome: a thin top bar and nothing else.
 *
 * No sidebar, no breadcrumb trail, no dashboard widgets around the editor. The
 * screen budget belongs to the problem and the code.
 */
export function AppShell() {
  const navigate = useNavigate();

  const signOut = () => {
    tokenStore.clear();
    navigate('/login', { replace: true });
  };

  return (
    <Flex direction="column" h="100vh" bg="surface.0">
      <CommandPalette />

      <HStack
        as="header"
        h="48px"
        px={4}
        spacing={6}
        borderBottomWidth="1px"
        borderColor="surface.300"
        bg="surface.50"
        flexShrink={0}
      >
        <HStack as={Link} to="/" spacing={2} _hover={{ opacity: 0.85 }}>
          <Image src={appIcon} alt="" boxSize="22px" objectFit="contain" />
          <Text fontWeight={700} fontSize="sm" letterSpacing="-0.01em">
            <Box as="span" color="forge.500">
              Forge
            </Box>
            <Box as="span" color="ink.300">
              Routine
            </Box>
          </Text>
        </HStack>

        <HStack spacing={1} flex="1">
          <NavItem to="/">Dashboard</NavItem>
          <NavItem to="/technologies">Technologies</NavItem>
        </HStack>

        <HStack spacing={3}>
          <HStack
            spacing={1}
            px={2}
            py={1}
            borderRadius="md"
            borderWidth="1px"
            borderColor="surface.300"
            display={{ base: 'none', md: 'flex' }}
          >
            <Kbd fontSize="xs" bg="surface.300" borderColor="surface.400">
              ⌘
            </Kbd>
            <Kbd fontSize="xs" bg="surface.300" borderColor="surface.400">
              K
            </Kbd>
          </HStack>
          <Button variant="ghost" size="xs" onClick={signOut}>
            Sign out
          </Button>
        </HStack>
      </HStack>

      <Box flex="1" overflowY="auto" minH={0}>
        <Outlet />
      </Box>
    </Flex>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink to={to} end={to === '/'}>
      {({ isActive }) => (
        <Box
          px={3}
          py={1}
          borderRadius="md"
          fontSize="sm"
          fontWeight={isActive ? 600 : 400}
          color={isActive ? 'ink.100' : 'ink.400'}
          bg={isActive ? 'surface.200' : 'transparent'}
          _hover={{ color: 'ink.100' }}
        >
          {children}
        </Box>
      )}
    </NavLink>
  );
}
