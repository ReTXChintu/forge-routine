import { Box, Button, HStack, Text, VStack } from '@chakra-ui/react';
import { FiDownload, FiSmartphone } from 'react-icons/fi';

/**
 * The Android build, offered as a direct download.
 *
 * Served as a static file by the same host as the web app, so this is an
 * ordinary link rather than an API call — deliberately, because it must work
 * on the sign-in screen where there is no token to send.
 *
 * `download` on a cross-origin URL is ignored by browsers, so the file is
 * referenced by an absolute path on this origin. If the APK is ever moved to
 * a CDN this will start opening the file instead of saving it, and the
 * attribute will need replacing with a Content-Disposition header at the
 * other end.
 */
export const APK_URL = '/Forgeroutine.apk';

export function DownloadApkButton({
  variant = 'ghost',
  size = 'xs',
}: {
  variant?: string;
  size?: string;
}) {
  return (
    <Button
      as="a"
      href={APK_URL}
      download
      variant={variant}
      size={size}
      color="ink.400"
      _hover={{ color: 'forge.400' }}
      leftIcon={<Box as={FiDownload} />}
    >
      Android app
    </Button>
  );
}

/**
 * The same download with an explanation, for the sign-in screen.
 *
 * Placed below the form and reachable without an account: someone deciding
 * whether this product is worth their evening should be able to look at it
 * on their phone first, and making them register to find out is the wrong
 * order.
 */
export function DownloadApkCard() {
  return (
    <VStack
      align="stretch"
      spacing={2}
      borderWidth="1px"
      borderColor="surface.300"
      borderRadius="md"
      p={4}
      mt={6}
    >
      <HStack spacing={2}>
        <Box as={FiSmartphone} color="ink.400" fontSize="sm" />
        <Text fontSize="sm" color="ink.200" fontWeight={500}>
          Prefer your phone?
        </Text>
      </HStack>

      <Text fontSize="xs" color="ink.500" lineHeight="1.6">
        The Android app covers today&apos;s work, reviews and interviews — including answering an
        interview out loud. Writing code stays at a desk.
      </Text>

      <Button
        as="a"
        href={APK_URL}
        download
        size="sm"
        variant="outline"
        mt={1}
        leftIcon={<Box as={FiDownload} />}
      >
        Download the APK
      </Button>

      {/* Said plainly. A browser will warn about this file and a user who was
          not expecting the warning will assume something is wrong. */}
      <Text fontSize="xs" color="ink.500">
        Installing outside the Play Store means allowing your browser to install unknown apps. Your
        phone will ask.
      </Text>
    </VStack>
  );
}
