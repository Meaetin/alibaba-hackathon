/**
 * Travel Persona Quiz — questions, archetypes, and scoring.
 *
 * Question copy is seeded from `docs/travel-persona-quiz.html`; the option
 * score vectors and archetype centers follow
 * `docs/travel-persona-quiz-methodology.md` and `docs/archetype-personas.md`.
 * Scoring is pure and deterministic: sum the selected option vectors, average
 * across the 12 questions, then match the nearest archetype center by
 * Euclidean distance in 4D space.
 */

import type {
  ArchetypeDefinition,
  DimensionKey,
  DimensionScores,
  PersonaResult,
  QuizAnswers,
  QuizQuestion,
} from "./types";

/** Display metadata for the four axes (result screen DNA bars). */
export const DIMENSION_AXES: Array<{
  key: DimensionKey;
  label: string;
  low: string;
  high: string;
}> = [
  { key: "structure", label: "Structure", low: "Planner", high: "Spontaneous" },
  { key: "comfort", label: "Comfort", low: "Luxury", high: "Roughing It" },
  { key: "focus", label: "Focus", low: "Highlights", high: "Immersion" },
  { key: "social", label: "Social", low: "Group", high: "Solo" },
];

export const QUESTIONS: QuizQuestion[] = [
  {
    label: "Trip Prep",
    text: "You just booked a 2-week trip to Japan. What's your next move?",
    options: [
      {
        icon: "📋",
        title: "Spreadsheet time",
        description:
          "Build a day-by-day itinerary with backup plans, restaurant reservations, and transit schedules.",
        scores: { structure: 0, comfort: 25, focus: 40, social: 50 },
      },
      {
        icon: "📌",
        title: "Bookmark a few things",
        description: "Save a handful of must-sees and figure the rest out when you land.",
        scores: { structure: 45, comfort: 40, focus: 50, social: 50 },
      },
      {
        icon: "🎒",
        title: "Just pack and go",
        description: "The best trips are unplanned. You'll ask locals and follow your gut.",
        scores: { structure: 90, comfort: 55, focus: 65, social: 50 },
      },
    ],
  },
  {
    label: "First Morning",
    text: "It's your first morning in a new city. How does your day start?",
    options: [
      {
        icon: "🗺️",
        title: "Hit the landmarks",
        description:
          "Early start, camera ready — you want to see the iconic sights before the crowds.",
        scores: { structure: 20, comfort: 30, focus: 25, social: 50 },
      },
      {
        icon: "☕",
        title: "Wander to a café",
        description:
          "Find a neighborhood coffee spot, people-watch, and let the day unfold naturally.",
        scores: { structure: 75, comfort: 40, focus: 65, social: 55 },
      },
      {
        icon: "🏞️",
        title: "Find the wild side",
        description:
          "Head straight for a trail, a viewpoint, or anywhere that gets you into nature.",
        scores: { structure: 60, comfort: 75, focus: 55, social: 65 },
      },
    ],
  },
  {
    label: "Accommodation",
    text: "Where do you genuinely prefer to sleep on a trip?",
    options: [
      {
        icon: "🏨",
        title: "A great hotel",
        description: "Room service, a nice bed, maybe a pool. Travel should feel like a treat.",
        scores: { structure: 25, comfort: 5, focus: 30, social: 40 },
      },
      {
        icon: "🏠",
        title: "Local Airbnb or guesthouse",
        description: "A neighborhood feel, a local host's tips, and a kitchen to make breakfast.",
        scores: { structure: 50, comfort: 45, focus: 60, social: 45 },
      },
      {
        icon: "⛺",
        title: "Hostel, camp, or wherever",
        description: "You've slept in airports, hammocks, and tents — comfort is overrated.",
        scores: { structure: 70, comfort: 90, focus: 65, social: 35 },
      },
    ],
  },
  {
    label: "Pace",
    text: "What does your ideal travel day look like?",
    options: [
      {
        icon: "⚡",
        title: "Packed from dawn to dusk",
        description:
          "Morning hike, midday museum, afternoon food tour, evening show — maximize every moment.",
        scores: { structure: 15, comfort: 30, focus: 30, social: 50 },
      },
      {
        icon: "🌊",
        title: "A loose rhythm",
        description:
          "One or two planned things, with lots of space to wander, rest, or change plans.",
        scores: { structure: 55, comfort: 45, focus: 55, social: 50 },
      },
      {
        icon: "🛋️",
        title: "Slow and unhurried",
        description: "Maybe one activity. Maybe none. Naps, long meals, and zero pressure.",
        scores: { structure: 80, comfort: 25, focus: 60, social: 55 },
      },
    ],
  },
  {
    label: "Culture",
    text: "You arrive somewhere with a totally different culture. You…",
    options: [
      {
        icon: "🎭",
        title: "Dive in completely",
        description:
          "Learn basic phrases, eat what locals eat, attend ceremonies, try to understand daily life.",
        scores: { structure: 50, comfort: 60, focus: 95, social: 55 },
      },
      {
        icon: "📸",
        title: "Sample the highlights",
        description: "Visit the key cultural sites, try the famous dishes, snap great photos.",
        scores: { structure: 30, comfort: 35, focus: 40, social: 45 },
      },
      {
        icon: "🧘",
        title: "Observe from a distance",
        description:
          "You appreciate the difference, but you also enjoy finding familiar comforts.",
        scores: { structure: 40, comfort: 20, focus: 20, social: 60 },
      },
    ],
  },
  {
    label: "Social Style",
    text: "On a trip, your social energy usually looks like…",
    options: [
      {
        icon: "👥",
        title: "Group all the way",
        description:
          "You travel with friends or family and love every minute of shared experiences.",
        scores: { structure: 35, comfort: 35, focus: 40, social: 5 },
      },
      {
        icon: "🤝",
        title: "Meet people along the way",
        description:
          "You might travel solo but love striking up conversations and joining local gatherings.",
        scores: { structure: 55, comfort: 55, focus: 65, social: 45 },
      },
      {
        icon: "🚶",
        title: "Happy on your own",
        description: "Solo travel is your therapy. You recharge by wandering, journaling, and thinking.",
        scores: { structure: 65, comfort: 50, focus: 70, social: 95 },
      },
    ],
  },
  {
    label: "Food",
    text: "When it comes to food on the road, you're most excited about…",
    options: [
      {
        icon: "🍽️",
        title: "The food IS the trip",
        description:
          "You plan entire days around meals — markets, cooking classes, hole-in-the-wall gems.",
        scores: { structure: 40, comfort: 50, focus: 75, social: 45 },
      },
      {
        icon: "🌮",
        title: "Street food adventures",
        description: "You'll eat anything, anywhere. The weirder and more local, the better.",
        scores: { structure: 65, comfort: 80, focus: 70, social: 50 },
      },
      {
        icon: "🥗",
        title: "Fuel for the journey",
        description:
          "Food matters, but you'd rather spend time doing things than obsessing over restaurants.",
        scores: { structure: 30, comfort: 30, focus: 30, social: 55 },
      },
    ],
  },
  {
    label: "Risk & Comfort",
    text: "A local invites you to a village festival 3 hours away by bus. You…",
    options: [
      {
        icon: "🚌",
        title: "Go immediately",
        description:
          "These spontaneous invitations are the best part of traveling. Say yes first, plan later.",
        scores: { structure: 90, comfort: 75, focus: 80, social: 40 },
      },
      {
        icon: "🤔",
        title: "Check reviews first",
        description:
          "Sounds fun, but let me Google it, check the safety situation, and confirm transport.",
        scores: { structure: 20, comfort: 30, focus: 50, social: 55 },
      },
      {
        icon: "😊",
        title: "Politely decline",
        description:
          "You appreciate it, but your comfort zone is your happy place. Maybe next time.",
        scores: { structure: 25, comfort: 10, focus: 20, social: 65 },
      },
    ],
  },
  {
    label: "Packing",
    text: "Be honest — what does your packing look like?",
    options: [
      {
        icon: "🧳",
        title: "Color-coded and labeled",
        description:
          "Packing cubes, a checklist, and outfits planned for each day. You pack to be prepared.",
        scores: { structure: 5, comfort: 20, focus: 35, social: 50 },
      },
      {
        icon: "🎒",
        title: "One carry-on, essentials only",
        description: "You've mastered minimalism. Quick-dry fabrics, universal adapter, done.",
        scores: { structure: 55, comfort: 65, focus: 55, social: 55 },
      },
      {
        icon: "🤷",
        title: "Throw things in a bag",
        description: "You'll buy what you forget. Packing stresses you out more than forgetting stuff.",
        scores: { structure: 85, comfort: 55, focus: 50, social: 45 },
      },
    ],
  },
  {
    label: "Memories",
    text: "What makes a trip truly unforgettable for you?",
    options: [
      {
        icon: "🏔️",
        title: "An epic adventure",
        description:
          "Summiting a peak, diving a reef, or surviving something wild — the story matters.",
        scores: { structure: 45, comfort: 80, focus: 50, social: 45 },
      },
      {
        icon: "💬",
        title: "A deep human connection",
        description: "A conversation with a stranger that changed how you see the world.",
        scores: { structure: 65, comfort: 55, focus: 90, social: 50 },
      },
      {
        icon: "🌅",
        title: "A perfect, peaceful moment",
        description: "Watching a sunset from a balcony with nowhere to be. Pure contentment.",
        scores: { structure: 55, comfort: 15, focus: 55, social: 70 },
      },
    ],
  },
  {
    label: "Detours",
    text: "Your train breaks down in a small town not on your itinerary. You feel…",
    options: [
      {
        icon: "😤",
        title: "Frustrated",
        description: "This wasn't the plan. You immediately look for alternatives to get back on track.",
        scores: { structure: 5, comfort: 25, focus: 30, social: 55 },
      },
      {
        icon: "🤩",
        title: "Delighted",
        description: "Plot twist! This is now an adventure. Let's explore this town.",
        scores: { structure: 90, comfort: 65, focus: 70, social: 45 },
      },
      {
        icon: "😌",
        title: "Chill about it",
        description: "Delays happen. You'll find a café, read a book, and deal with it when it's fixed.",
        scores: { structure: 60, comfort: 35, focus: 50, social: 60 },
      },
    ],
  },
  {
    label: "Homecoming",
    text: "You're home. What's the first thing people hear from you?",
    options: [
      {
        icon: "📊",
        title: "\"Let me show you my slides\"",
        description:
          "Organized photo albums, stories sorted by day, and restaurant recs for everyone.",
        scores: { structure: 10, comfort: 30, focus: 35, social: 35 },
      },
      {
        icon: "✨",
        title: "\"You HAVE to go there\"",
        description:
          "Pure excitement. You're already planning your return or telling everyone to book a ticket.",
        scores: { structure: 45, comfort: 40, focus: 55, social: 25 },
      },
      {
        icon: "🌍",
        title: "\"Where to next?\"",
        description: "Home feels small already. You're scrolling for the next destination before jet lag ends.",
        scores: { structure: 70, comfort: 55, focus: 60, social: 55 },
      },
    ],
  },
];

export const ARCHETYPES: ArchetypeDefinition[] = [
  {
    id: "master_planner",
    name: "The Master Planner",
    icon: "📋",
    tagline: "A well-organized trip is a beautiful trip.",
    description:
      "You travel like you live — with intention, preparation, and a spreadsheet that would impress a project manager. Every detail is considered, from the optimal time to visit each landmark to the best seat at the best restaurant. You're not rigid — you're optimized. Your trips run so smoothly that travel companions feel like they're on a luxury guided tour, even when it's all you.",
    traits: {
      style: "Highly Organized",
      vibe: "Prepared & Polished",
      superpower: "Logistics wizard",
      blindspot: "Over-scheduling",
    },
    destinations: ["Japan", "Switzerland", "Singapore", "Germany"],
    center: { structure: 5, comfort: 25, focus: 35, social: 45 },
  },
  {
    id: "spontaneous_wanderer",
    name: "The Spontaneous Wanderer",
    icon: "🌬️",
    tagline: "The best plan is no plan at all.",
    description:
      "You follow the wind. Guidebooks are suggestions, itineraries are fiction, and the best moments are the ones you never saw coming. You thrive on serendipity — a missed train becomes a new friendship, a wrong turn leads to a hidden beach. You travel light, think fast, and collect stories instead of souvenirs.",
    traits: {
      style: "Free-spirited",
      vibe: "Adaptable & Bold",
      superpower: "Serendipity magnet",
      blindspot: "Missing reservations",
    },
    destinations: ["India", "Thailand", "Morocco", "Colombia"],
    center: { structure: 90, comfort: 65, focus: 60, social: 50 },
  },
  {
    id: "cultural_diver",
    name: "The Cultural Diver",
    icon: "🎭",
    tagline: "I don't visit places — I try to understand them.",
    description:
      "You travel to learn. Museums, temples, language exchanges, home-cooked meals with strangers — these aren't activities for you, they're the whole point. You read history books before flights, attempt the local language (badly, bravely), and come home with a deeper understanding of something bigger than yourself.",
    traits: {
      style: "Deeply Curious",
      vibe: "Empathetic & Intellectual",
      superpower: "Cultural fluency",
      blindspot: "Overlooking rest",
    },
    destinations: ["Italy", "Mexico", "Turkey", "Vietnam"],
    center: { structure: 50, comfort: 60, focus: 95, social: 50 },
  },
  {
    id: "thrill_seeker",
    name: "The Thrill Seeker",
    icon: "⚡",
    tagline: "If it doesn't scare me a little, it's not worth doing.",
    description:
      "You travel for adrenaline. Summiting volcanoes at dawn, cliff-diving in Croatia, motorbiking the Ha Giang Loop — your trips are measured in heartbeats, not hotel stars. You're not reckless; you're alive in a way that only comes from pushing past the edge of your comfort zone. Your camera roll looks like a Red Bull ad.",
    traits: {
      style: "Adrenaline-driven",
      vibe: "Fearless & Physical",
      superpower: "Courage under pressure",
      blindspot: "Burnout & injury",
    },
    destinations: ["New Zealand", "Nepal", "Iceland", "Costa Rica"],
    center: { structure: 40, comfort: 85, focus: 50, social: 40 },
  },
  {
    id: "comfort_cruiser",
    name: "The Comfort Cruiser",
    icon: "🛋️",
    tagline: "Travel should feel better than home, not harder.",
    description:
      "You've earned your relaxation, and you travel to enjoy it. Five-star hotels, ocean-view suites, spa days, and slow mornings with room service — this is your idea of paradise. You're not lazy; you're intentional about rest. Your trips are designed to recharge you, and you return home genuinely renewed.",
    traits: {
      style: "Leisure-first",
      vibe: "Refined & Relaxed",
      superpower: "Finding the best of everything",
      blindspot: "Missing local texture",
    },
    destinations: ["Maldives", "Santorini", "Bali", "Amalfi Coast"],
    center: { structure: 25, comfort: 5, focus: 25, social: 50 },
  },
  {
    id: "culinary_nomad",
    name: "The Culinary Nomad",
    icon: "🍜",
    tagline: "Tell me what a city eats, and I'll tell you what it is.",
    description:
      "For you, the meal IS the trip. You plan entire days around food — morning markets, cooking classes, lunch at the place with no English menu, dinner at the grandmother's kitchen you found through a local. You understand cultures through their kitchens, and your souvenir is always a new recipe.",
    traits: {
      style: "Food-driven",
      vibe: "Sensory & Social",
      superpower: "Finding hidden gems",
      blindspot: "Ignoring non-food experiences",
    },
    destinations: ["Japan", "Thailand", "Peru", "France"],
    center: { structure: 45, comfort: 55, focus: 75, social: 40 },
  },
  {
    id: "soulful_soloist",
    name: "The Soulful Soloist",
    icon: "🧘",
    tagline: "I travel to meet myself, somewhere new.",
    description:
      "Solo travel isn't just a preference for you — it's a practice. You journey outward to look inward. Long walks, journaling in cafés, meditation retreats, quiet sunrise viewpoints. You don't avoid people; you seek depth over small talk. Your best travel memories are quiet moments of clarity that changed something in you.",
    traits: {
      style: "Reflective & Independent",
      vibe: "Introspective & Calm",
      superpower: "Self-awareness",
      blindspot: "Isolating too much",
    },
    destinations: ["Bali", "Portugal", "Sri Lanka", "Patagonia"],
    center: { structure: 60, comfort: 45, focus: 70, social: 95 },
  },
  {
    id: "social_explorer",
    name: "The Social Explorer",
    icon: "🎉",
    tagline: "Every stranger is a friend I haven't met yet.",
    description:
      "You travel for people. The places are backdrop; the connections are the trip. You're the one who ends up at a family dinner in someone's home, dancing at a local wedding you weren't invited to, or hosting a rooftop dinner for hostel friends. You collect people, not stamps.",
    traits: {
      style: "People-first",
      vibe: "Warm & Magnetic",
      superpower: "Building instant bonds",
      blindspot: "Neglecting solo reflection",
    },
    destinations: ["Spain", "Brazil", "Ireland", "Philippines"],
    center: { structure: 55, comfort: 45, focus: 60, social: 5 },
  },
  {
    id: "nature_pilgrim",
    name: "The Nature Pilgrim",
    icon: "🏔️",
    tagline: "The mountains don't care about my inbox, and that's why I love them.",
    description:
      "Cities are fine, but you come alive in the wild. Hiking boots, tent poles, and trail maps are your travel essentials. You measure a trip in elevation gained, waterfalls found, and stars seen. Silence, fresh air, and the scale of nature put everything else in perspective. You don't conquer mountains — they recalibrate you.",
    traits: {
      style: "Outdoors & Active",
      vibe: "Grounded & Resilient",
      superpower: "Endurance & presence",
      blindspot: "Skipping urban culture",
    },
    destinations: ["Patagonia", "Norway", "Banff", "Nepal"],
    center: { structure: 55, comfort: 80, focus: 55, social: 65 },
  },
  {
    id: "bucket_list_chaser",
    name: "The Bucket List Chaser",
    icon: "🏆",
    tagline: "Life is short. I'm checking things off.",
    description:
      "You've got a list, and you're working through it. Northern Lights? Done. Machu Picchu? Check. Swimming with whale sharks? Next month. You're driven by iconic experiences and once-in-a-lifetime moments. Your trips are ambitious, visually stunning, and make for incredible stories. You inspire everyone around you to dream bigger.",
    traits: {
      style: "Goal-driven",
      vibe: "Ambitious & Energetic",
      superpower: "Making things happen",
      blindspot: "Rushing past the present",
    },
    destinations: ["Iceland", "Tanzania", "Egypt", "Galápagos"],
    center: { structure: 25, comfort: 35, focus: 30, social: 40 },
  },
  {
    id: "slow_immersionist",
    name: "The Slow Immersionist",
    icon: "🕰️",
    tagline: "I don't visit. I stay.",
    description:
      "You don't do drive-by tourism. When you travel, you embed. You rent an apartment, find a regular café, learn the neighborhood rhythms. Two weeks in one village beats seven cities in seven days, every time. You believe travel should change how you live, not just fill your photo album.",
    traits: {
      style: "Slow & Deep",
      vibe: "Patient & Observant",
      superpower: "Becoming local anywhere",
      blindspot: "Missing variety",
    },
    destinations: ["Tuscany", "Kyoto", "Oaxaca", "Lisbon"],
    center: { structure: 70, comfort: 40, focus: 85, social: 65 },
  },
  {
    id: "weekend_warrior",
    name: "The Weekend Warrior",
    icon: "🚀",
    tagline: "48 hours is enough if you use them right.",
    description:
      "You don't wait for the perfect two-week window. You grab a Friday night flight and squeeze every ounce of adventure out of 48 hours. Packed itineraries, efficient logistics, maximum experience per hour — you're a master of the micro-trip. Your coworkers don't understand how you saw so much in so little time.",
    traits: {
      style: "Efficient & Intense",
      vibe: "High-energy & Focused",
      superpower: "Time maximization",
      blindspot: "Never fully unwinding",
    },
    destinations: ["Barcelona", "Bangkok", "New York", "Mexico City"],
    center: { structure: 15, comfort: 35, focus: 40, social: 30 },
  },
];

const DIMENSION_KEYS: DimensionKey[] = ["structure", "comfort", "focus", "social"];

/** Sum the selected option vectors and average across all questions (0–100). */
export function scoreAnswers(answers: QuizAnswers): DimensionScores {
  const totals: DimensionScores = { structure: 0, comfort: 0, focus: 0, social: 0 };

  answers.forEach((optionIndex, questionIndex) => {
    if (optionIndex === null) return;
    const { scores } = QUESTIONS[questionIndex].options[optionIndex];
    for (const key of DIMENSION_KEYS) totals[key] += scores[key];
  });

  const answered = Math.max(
    1,
    answers.filter((a) => a !== null).length,
  );
  const averaged = {} as DimensionScores;
  for (const key of DIMENSION_KEYS) {
    averaged[key] = Math.round(totals[key] / answered);
  }
  return averaged;
}

function distance(a: DimensionScores, b: DimensionScores): number {
  return Math.sqrt(
    DIMENSION_KEYS.reduce((sum, key) => sum + (a[key] - b[key]) ** 2, 0),
  );
}

/** Match a coordinate to its nearest archetype center (Euclidean, 4D). */
export function matchArchetype(dimensions: DimensionScores): PersonaResult {
  const ranked = [...ARCHETYPES]
    .map((archetype) => ({ archetype, dist: distance(dimensions, archetype.center) }))
    .sort((a, b) => a.dist - b.dist);

  const [first, second] = ranked;
  const total = first.dist + second.dist;
  // 1 = lands exactly on the primary center; 0.5 = tied with the secondary.
  const confidence = total === 0 ? 1 : Math.round((1 - first.dist / total) * 100) / 100;

  return {
    dimensions,
    archetype: first.archetype,
    secondaryArchetype: second.archetype,
    confidence,
  };
}

/** Full quiz pipeline: answers → Travel DNA → archetype match. */
export function calculatePersona(answers: QuizAnswers): PersonaResult {
  return matchArchetype(scoreAnswers(answers));
}

/**
 * Whether an answer set can be scored at all.
 *
 * `scoreAnswers` indexes straight into `QUESTIONS[i].options[answer]`, so an
 * index one past the end of a three-option question throws rather than scoring
 * badly. The rule lives here because this module owns `QUESTIONS`; a route
 * handler checking option counts would be a second copy of the quiz's shape.
 *
 * `null` is valid — an unanswered question simply contributes nothing and the
 * average is taken over the answered ones.
 */
export function isScorableAnswers(answers: QuizAnswers): boolean {
  if (answers.length !== QUESTIONS.length) return false;
  return answers.every((answer, index) => {
    if (answer === null) return true;
    return Number.isInteger(answer) && answer >= 0 && answer < QUESTIONS[index].options.length;
  });
}
