import {
  Box,
  Button,
  Grid,
  HStack,
  Heading,
  IconButton,
  Input,
  Spinner,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react';
import { useState } from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

import type { UserTechnology } from '@forgeroutine/shared-types';

import {
  useAddTechnology,
  useArchiveTechnology,
  useCatalogue,
  useMyTechnologies,
} from '~/lib/queries';

/**
 * Technology management (§25).
 *
 * The user owns their learning universe. Anything in the catalogue can be added,
 * and anything *not* in the catalogue can be created by typing its name — Rust
 * today, Kubernetes next week, with no release in between (§41).
 */
export function Technologies() {
  const [search, setSearch] = useState('');
  const { data: mine, isLoading } = useMyTechnologies();
  const { data: catalogue } = useCatalogue(search);
  const addTechnology = useAddTechnology();
  const archive = useArchiveTechnology();
  const toast = useToast();
  const navigate = useNavigate();

  const ownedIds = new Set((mine ?? []).map((t) => t.technologyId));
  const available = (catalogue ?? []).filter((t) => !ownedIds.has(t.id));
  const exactMatch = (catalogue ?? []).some(
    (t) => t.name.toLowerCase() === search.trim().toLowerCase(),
  );
  const canCreate = search.trim().length > 1 && !exactMatch;

  const add = async (input: { technologyId?: string; name?: string }, label: string) => {
    await addTechnology.mutateAsync(input);
    toast({
      title: `${label} added`,
      description: 'Curriculum, prerequisites and exercises are ready.',
      status: 'success',
      duration: 4000,
      position: 'bottom-right',
    });
    setSearch('');
  };

  return (
    <Box maxW="1000px" mx="auto" px={6} py={8}>
      <Heading size="lg" mb={1} fontWeight={650}>
        My technologies
      </Heading>
      <Text fontSize="sm" color="ink.400" mb={6}>
        Add anything. Removing keeps your history.
      </Text>

      {isLoading ? (
        <HStack justify="center" py={12}>
          <Spinner color="forge.500" />
        </HStack>
      ) : (
        <VStack align="stretch" spacing={2} mb={8}>
          {(mine ?? []).length === 0 && (
            <Text fontSize="sm" color="ink.500">
              Nothing yet. Add one below.
            </Text>
          )}
          {(mine ?? []).map((item) => (
            <TechnologyRow
              key={item.id}
              item={item}
              onOpen={() => navigate(`/technology/${item.technologyId}`)}
              onRemove={() => archive.mutate(item.id)}
            />
          ))}
        </VStack>
      )}

      <Box borderTopWidth="1px" borderColor="surface.300" pt={6}>
        <Text fontSize="xs" color="ink.400" letterSpacing="0.06em" mb={3}>
          ADD A TECHNOLOGY
        </Text>

        <Input
          placeholder="Search, or type anything — Rust, Kubernetes, Terraform…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          mb={3}
        />

        {canCreate && (
          <Button
            leftIcon={<FiPlus />}
            mb={3}
            isLoading={addTechnology.isPending}
            onClick={() => void add({ name: search.trim() }, search.trim())}
          >
            Add “{search.trim()}”
          </Button>
        )}

        <Grid templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }} gap={2}>
          {available.slice(0, 24).map((technology) => (
            <Button
              key={technology.id}
              variant="outline"
              justifyContent="flex-start"
              h="auto"
              py={2}
              px={3}
              isLoading={addTechnology.isPending}
              onClick={() => void add({ technologyId: technology.id }, technology.name)}
            >
              <Box textAlign="left" w="100%" minW={0}>
                <Text fontSize="sm" color="ink.200" noOfLines={1}>
                  {technology.name}
                </Text>
                <Text fontSize="xs" color="ink.500" fontWeight={400} noOfLines={1}>
                  {technology.category}
                </Text>
              </Box>
            </Button>
          ))}
        </Grid>
      </Box>
    </Box>
  );
}

function TechnologyRow({
  item,
  onOpen,
  onRemove,
}: {
  item: UserTechnology;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <HStack
      bg="surface.100"
      borderWidth="1px"
      borderColor="surface.300"
      borderRadius="md"
      px={4}
      py={3}
      spacing={4}
      _hover={{ borderColor: 'surface.400' }}
      cursor="pointer"
      onClick={onOpen}
    >
      <Box flex="1" minW={0}>
        <Text fontSize="sm" color="ink.100" fontWeight={600}>
          {item.technology?.name ?? 'Unknown'}
        </Text>
        <Text fontSize="xs" color="ink.500">
          {item.priority.toLowerCase()} priority · target {item.targetProficiency.toLowerCase()}
          {item.status === 'PAUSED' && ' · paused'}
        </Text>
      </Box>

      <IconButton
        aria-label={`Remove ${item.technology?.name ?? 'technology'}`}
        icon={<FiX />}
        variant="ghost"
        size="xs"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      />
    </HStack>
  );
}
