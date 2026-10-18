import { AppPageContainer } from "@/components/app-page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <AppPageContainer width="wide" variant="marketing">
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </AppPageContainer>
  );
}
