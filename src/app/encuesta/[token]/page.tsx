import type { Metadata } from "next";
import { SurveyForm } from "@/modules/surveys/survey-form";

export const metadata: Metadata = { title: "¿Cómo te atendimos?", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SurveyForm token={token} />;
}
