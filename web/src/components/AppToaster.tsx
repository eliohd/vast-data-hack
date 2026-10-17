import { Toaster } from '@/components/ui/sonner';

/** Island wrapper so Astro pages can mount the shared toaster once. */
export default function AppToaster() {
  return <Toaster position="top-center" richColors />;
}
