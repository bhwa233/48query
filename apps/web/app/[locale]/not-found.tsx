import { headers } from "next/headers";
import { AppPageContainer, SectionIntro } from "@/components/app-page-shell";
import { Button } from "@/components/ui/button";
import { messages } from "@/i18n/messages";

export default async function NotFound() {
  const locale =
    (await headers()).get("x-next-intl-locale") === "zh" ? "zh" : "en";
  const copy = messages[locale].errors;
  return (
    <AppPageContainer width="narrow" variant="marketing">
      <SectionIntro
        title={<h1>{copy.notFound}</h1>}
        description={copy.notFoundText}
      />
      <Button asChild className="w-fit">
        <a href={`/${locale}`}>{copy.home}</a>
      </Button>
    </AppPageContainer>
  );
}
