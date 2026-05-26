"use client";

import { CheckCircle2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/context";

interface SignatureSummaryProps {
  pilotSigned: boolean;
  supplierSigned: boolean;
  className?: string;
}

export function SignatureSummary({ pilotSigned, supplierSigned, className }: SignatureSummaryProps) {
  const t = useT();
  const both = pilotSigned && supplierSigned;
  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        both
          ? "border-brand-200 bg-brand-50/60"
          : "border-amber-200 bg-amber-50/60",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {both ? (
          <CheckCircle2 className="h-5 w-5 text-brand-700 flex-shrink-0" />
        ) : (
          <AlertCircle className="h-5 w-5 text-amber-700 flex-shrink-0" />
        )}
        <p className={cn("text-sm font-medium", both ? "text-brand-900" : "text-amber-900")}>
          {both ? t.sigSummary.allSigned : t.sigSummary.needBoth}
        </p>
      </div>
      <div className="mt-3 flex gap-2 flex-wrap">
        <Badge tone={pilotSigned ? "success" : "warning"}>
          {pilotSigned ? t.sigSummary.pilotSigned : t.sigSummary.pilotPending}
        </Badge>
        <Badge tone={supplierSigned ? "success" : "warning"}>
          {supplierSigned ? t.sigSummary.supplierSigned : t.sigSummary.supplierPending}
        </Badge>
      </div>
    </div>
  );
}
