import Image from "next/image";

import { cn } from "@/lib/utils";

type AircraftSeatMapSvgProps = {
  className?: string;
};

export function AircraftSeatMapSvg({ className }: AircraftSeatMapSvgProps) {
  return (
    <Image
      alt="Top-down passenger aircraft"
      className={cn("h-full w-full object-contain", className)}
      data-region="flights-aircraft-svg"
      height={1764}
      priority={false}
      src="/assets/flights/plane.svg"
      unoptimized
      width={891}
    />
  );
}
