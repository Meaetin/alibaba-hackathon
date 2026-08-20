"use client";

import { useMapsLibrary, APIProvider } from "@vis.gl/react-google-maps";
import { Field } from "@base-ui/react/field";
import { ChevronDown, MapPin, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { inputVariants, inputControlVariants } from "@/components/ui/primitives/Input";
import { menuItemVariants } from "@/components/ui/primitives/Menu";
import { trackPlacesAutocomplete } from "@/lib/api/maps";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export interface PlaceResult {
  description: string;
  region: string | null;
  country: string;
  latitude: number;
  longitude: number;
}

interface PlaceAutocompleteProps {
  className?: string;
  /** className merged into the inner input wrapper (e.g. size/radius overrides) */
  inputClassName?: string;
  placeholder?: string;
  icon?: ReactNode;
  invalid?: boolean;
  defaultPlace?: PlaceResult | null;
  onPlaceSelect?: (place: PlaceResult | null) => void;
}

function extractPlaceResult(
  place: google.maps.places.PlaceResult,
): PlaceResult | null {
  const comps = place.address_components ?? [];
  const regionComp = comps.find((c) => c.types.includes("locality"))
    ?? comps.find((c) => c.types.includes("administrative_area_level_1"))
    ?? comps.find((c) => c.types.includes("administrative_area_level_2"))
    ?? comps.find((c) => c.types.includes("postal_town"));
  const countryComp = comps.find((c) => c.types.includes("country"));
  const location = place.geometry?.location;

  if (!countryComp || !location) return null;

  const descriptionParts = [regionComp?.long_name, countryComp.long_name].filter(Boolean);
  return {
    description: descriptionParts.join(", ") || (place.formatted_address ?? place.name ?? ""),
    region: regionComp?.long_name ?? null,
    country: countryComp.long_name,
    latitude: location.lat(),
    longitude: location.lng(),
  };
}

function PlaceAutocompleteInner({
  className,
  inputClassName,
  placeholder = "Search region or country",
  icon = <MapPin />,
  invalid,
  defaultPlace,
  onPlaceSelect,
}: PlaceAutocompleteProps) {
  const placesLib = useMapsLibrary("places");

  const autocompleteService = useMemo(
    () => placesLib ? new google.maps.places.AutocompleteService() : null,
    [placesLib],
  );

  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const attributionRef = useRef<HTMLDivElement>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    if (placesLib && attributionRef.current && !placesServiceRef.current) {
      placesServiceRef.current = new google.maps.places.PlacesService(attributionRef.current);
    }
  }, [placesLib]);

  const getSessionToken = useCallback(() => {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
    }
    return sessionTokenRef.current;
  }, []);

  const inputWrapperRef = useRef<HTMLDivElement>(null);

  const [inputValue, setInputValue] = useState(defaultPlace?.description ?? "");
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (defaultPlace) onPlaceSelect?.(defaultPlace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const genRef = useRef(0);

  const fetchPredictions = useCallback((input: string) => {
    if (!autocompleteService || input.length < 2) {
      setPredictions([]);
      setIsOpen(false);
      return;
    }

    const gen = ++genRef.current;
    setIsLoading(true);

    autocompleteService.getPlacePredictions(
      { input, types: ["locality", "country", "administrative_area_level_1", "administrative_area_level_2"], sessionToken: getSessionToken() },
      (results, status) => {
        if (gen !== genRef.current) return;
        setIsLoading(false);

        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          setPredictions(results);
          setIsOpen(true);
          setActiveIndex(-1);
        } else {
          setPredictions([]);
          setIsOpen(false);
        }
      },
    );
  }, [autocompleteService, getSessionToken]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);
      onPlaceSelect?.(null);

      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchPredictions(value), 300);
    },
    [fetchPredictions, onPlaceSelect],
  );

  const selectPrediction = useCallback(
    (prediction: google.maps.places.AutocompletePrediction) => {
      if (!placesServiceRef.current) return;

      const token = getSessionToken();
      placesServiceRef.current.getDetails(
        {
          placeId: prediction.place_id,
          fields: ["address_components", "geometry", "formatted_address", "name"],
          sessionToken: token,
        },
        (place, status) => {
          sessionTokenRef.current = null;
          if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            const result = extractPlaceResult(place);
            if (result) {
              setInputValue(result.description);
              onPlaceSelect?.(result);
              trackPlacesAutocomplete();
            }
          }
        },
      );

      setPredictions([]);
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [onPlaceSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || predictions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev < predictions.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : predictions.length - 1));
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        selectPrediction(predictions[activeIndex]);
      } else if (e.key === "Escape") {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    },
    [isOpen, predictions, activeIndex, selectPrediction],
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".place-autocomplete-container") && !target.closest(".place-autocomplete-dropdown")) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    const handleDismiss = () => {
      setIsOpen(false);
      setActiveIndex(-1);
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [isOpen]);

  const hasValue = Boolean(inputValue);

  const handleClear = useCallback(() => {
    setInputValue("");
    setPredictions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    onPlaceSelect?.(null);
  }, [onPlaceSelect]);

  const updateDropdownPos = useCallback(() => {
    if (inputWrapperRef.current) {
      const rect = inputWrapperRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, []);

  useEffect(() => {
    if (isOpen) updateDropdownPos();
  }, [isOpen, updateDropdownPos]);

  return (
    <div className={cn("place-autocomplete-container relative w-[22.5rem]", className)}>
      <div ref={attributionRef} className="hidden" />

      <div
        ref={inputWrapperRef}
        className={cn(
          "input",
          inputVariants({ size: "md", hasValue, icon: "both" }),
          inputClassName,
        )}
        data-slot="input-wrapper"
        data-name="input"
        aria-invalid={invalid || undefined}
      >
        {icon && (
          <span className="input-icon flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4 [&_svg]:shrink-0">
            {icon}
          </span>
        )}
        <Field.Control
          className={cn("input-control", inputControlVariants())}
          value={inputValue}
          placeholder={placeholder}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (predictions.length > 0) setIsOpen(true);
          }}
          autoComplete="off"
        />
        {/* Trailing slot — clear when filled, spinner while loading, chevron when idle (Figma Empty state) */}
        {hasValue ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={handleClear}
            className="flex shrink-0 items-center justify-center size-5 rounded-full bg-surface-muted text-content-secondary hover:bg-surface-muted-active transition-colors cursor-pointer [&_svg]:size-3"
            aria-label="Clear"
          >
            <X />
          </button>
        ) : isLoading ? (
          <span className="place-autocomplete-loading flex shrink-0 items-center justify-center size-5">
            <span className="size-3 border-2 border-content-secondary/30 border-t-content-secondary rounded-full animate-spin" />
          </span>
        ) : (
          <span
            className="place-autocomplete-trailing-icon flex shrink-0 items-center justify-center size-5 text-content-secondary [&_svg]:size-4 [&_svg]:shrink-0"
            aria-hidden="true"
          >
            <ChevronDown />
          </span>
        )}
      </div>

      {isOpen && predictions.length > 0 && dropdownPos &&
        createPortal(
          <div
            className="place-autocomplete-dropdown fixed z-[200] bg-surface border border-edge rounded-2xl p-2 shadow-default max-h-60 overflow-y-auto"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          >
            <ul
              className="flex flex-col items-stretch gap-1"
              role="listbox"
            >
              {predictions.map((prediction, index) => (
                <li
                  key={prediction.place_id}
                  className={cn(
                    "place-autocomplete-item w-full cursor-pointer",
                    menuItemVariants({ size: "lg", icon: "none" }),
                    index === activeIndex && "bg-surface-alt border-edge-subtle",
                  )}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => selectPrediction(prediction)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="w-full truncate">{prediction.description}</span>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}

export function PlaceAutocomplete(props: PlaceAutocompleteProps) {
  return (
    <APIProvider apiKey={API_KEY}>
      <PlaceAutocompleteInner {...props} />
    </APIProvider>
  );
}
