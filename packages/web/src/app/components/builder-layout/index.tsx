import { ApEdition, ApFlagId } from '@activepieces/shared';

import { useEmbedding } from '@/components/providers/embed-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar-shadcn';
import { ManagePlanDialog } from '@/features/billing';
import { flagsHooks } from '@/hooks/flags-hooks';
import { useMorateaEditorSurface } from '@/lib/navigation-utils';
import { cn } from '@/lib/utils';

import {
  GlobalSearchProvider,
  useGlobalSearch,
} from '../global-search/global-search-context';
import { ProjectDashboardSidebar } from '../sidebar/dashboard';

export function BuilderLayout({ children }: { children: React.ReactNode }) {
  const isMorateaSurface = useMorateaEditorSurface();

  return (
    <GlobalSearchProvider disabled={isMorateaSurface}>
      <BuilderLayoutInner isMorateaSurface={isMorateaSurface}>
        {children}
      </BuilderLayoutInner>
    </GlobalSearchProvider>
  );
}

function BuilderLayoutInner({
  children,
  isMorateaSurface,
}: {
  children: React.ReactNode;
  isMorateaSurface: boolean;
}) {
  const { data: edition } = flagsHooks.useFlag<ApEdition>(ApFlagId.EDITION);
  const { embedState } = useEmbedding();
  const { open: searchOpen } = useGlobalSearch();

  return (
    <SidebarProvider hoverMode={!searchOpen} defaultOpen={false}>
      {!embedState.isEmbedded && !isMorateaSurface && (
        <ProjectDashboardSidebar />
      )}
      <SidebarInset
        className={cn(
          'flex flex-col h-full overflow-hidden',
          !isMorateaSurface && 'bg-sidebar',
        )}
      >
        <div
          className={cn(
            'flex-1 flex flex-col overflow-hidden',
            !embedState.isEmbedded && !isMorateaSurface && 'p-1.5',
          )}
        >
          <div
            className={cn(
              'flex flex-col h-full bg-background overflow-hidden',
              !isMorateaSurface &&
                (embedState.isEmbedded
                  ? 'border-l'
                  : 'rounded-xl shadow-[2px_0px_4px_-2px_rgba(0,0,0,0.05),0px_2px_4px_-2px_rgba(0,0,0,0.05)] border'),
            )}
          >
            {children}
          </div>
        </div>
        {!isMorateaSurface && edition !== ApEdition.COMMUNITY && (
          <ManagePlanDialog />
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
