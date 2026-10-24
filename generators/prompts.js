// Story templates. Each genre has 3 scenes; each scene offers 3 shots.
// `cast` = how many players the director picks for the scene.
// Prompts are written for an image-edit model (keyframe) and an image-to-video model (motion).

const GENRES = {
  heist: {
    label: 'Heist',
    blurb: 'Plan it, pull it, get away with it. Maybe.',
    title: (crew) => `The ${crew} job`,
    scenes: [
      { title: 'The plan', ask: 'Who’s running the plan?', cast: 1, shots: [
        { id: 'map', label: 'Map on the table', still: 'leaning over a blueprint map on a table in a dim warehouse, one desk lamp', motion: 'slow push-in, finger taps the map' },
        { id: 'lineup', label: 'Crew lineup', still: 'standing in a line facing camera in a parking garage, arms crossed', motion: 'low dolly sweep across the line' },
        { id: 'gear', label: 'Gear check', still: 'zipping a duffel bag of gadgets on a workbench', motion: 'handheld close-up, quick zip' },
      ]},
      { title: 'The getaway', ask: 'Who’s driving?', cast: 1, shots: [
        { id: 'chase', label: 'Car chase', still: 'driving a boxy old sedan at night, police lights far behind', motion: 'tracking shot alongside the car, motion streaks' },
        { id: 'rooftop', label: 'Rooftop jump', still: 'mid-leap between two city rooftops at night', motion: 'slow-motion leap, camera tilts with the jump' },
        { id: 'walk', label: 'Slow-mo walk', still: 'walking away from a building as sparks fall behind', motion: 'slow-motion walk toward camera' },
      ]},
      { title: 'The payoff', ask: 'Who opens the bag?', cast: 1, shots: [
        { id: 'bag', label: 'Open the bag', still: 'unzipping a money bag in a motel room', motion: 'push-in on the face as the bag opens' },
        { id: 'toast', label: 'Victory toast', still: 'raising a glass on a diner booth at sunrise', motion: 'slow orbit around the booth' },
        { id: 'busted', label: 'Busted', still: 'hands up in a spotlight in an alley', motion: 'quick zoom, light flicker' },
      ]},
    ],
  },
  horror: {
    label: 'Horror',
    blurb: 'Somebody’s not making it out of that house.',
    title: (crew) => `Don’t go in, ${crew}`,
    scenes: [
      { title: 'The arrival', ask: 'Who goes in first?', cast: 1, shots: [
        { id: 'door', label: 'Creaky door', still: 'pushing open a door of an abandoned house with a flashlight', motion: 'slow push through the doorway' },
        { id: 'van', label: 'Van pulls up', still: 'stepping out of a van at a foggy cabin', motion: 'low angle, fog drifts' },
        { id: 'sign', label: 'Warning sign', still: 'reading a hand-painted keep out sign in the woods', motion: 'rack focus from sign to face' },
      ]},
      { title: 'The noise', ask: 'Who hears it?', cast: 1, shots: [
        { id: 'hall', label: 'Dark hallway', still: 'frozen in a dark hallway, flashlight shaking', motion: 'slow creep forward, flashlight flicker' },
        { id: 'mirror', label: 'Mirror', still: 'staring into a dusty mirror in a bathroom', motion: 'slow push-in on the mirror' },
        { id: 'stairs', label: 'Basement stairs', still: 'at the top of basement stairs looking down', motion: 'vertigo zoom down the stairs' },
      ]},
      { title: 'The run', ask: 'Who’s running?', cast: 1, shots: [
        { id: 'woods', label: 'Run through the woods', still: 'sprinting through moonlit woods', motion: 'shaky tracking shot running' },
        { id: 'scream', label: 'Scream', still: 'screaming at camera in a dark room', motion: 'snap zoom to the face' },
        { id: 'safe', label: 'Made it out', still: 'collapsing on a lawn at dawn, laughing', motion: 'crane up and away' },
      ]},
    ],
  },
  romcom: {
    label: 'Rom-com',
    blurb: 'Meet-cutes, big gestures, bigger disasters.',
    title: (crew) => `Love, actually ${crew}`,
    scenes: [
      { title: 'The meet-cute', ask: 'Who bumps into who?', cast: 1, shots: [
        { id: 'coffee', label: 'Coffee spill', still: 'spilling coffee on themselves outside a café', motion: 'slow-motion spill' },
        { id: 'books', label: 'Dropped books', still: 'crouching to pick up dropped books on a sidewalk', motion: 'low angle push-in' },
        { id: 'rain', label: 'Caught in rain', still: 'running under a jacket in sudden rain', motion: 'tracking shot through the rain' },
      ]},
      { title: 'The big gesture', ask: 'Who makes the move?', cast: 1, shots: [
        { id: 'boombox', label: 'Boombox outside', still: 'holding a boombox overhead outside a window at night', motion: 'slow push-in, curtains move' },
        { id: 'airport', label: 'Airport run', still: 'running through an airport terminal', motion: 'tracking shot, crowd blur' },
        { id: 'sign2', label: 'Cardboard sign', still: 'holding a handmade cardboard sign on a doorstep', motion: 'slow tilt up from the sign' },
      ]},
      { title: 'The kiss… almost', ask: 'Who ruins it?', cast: 1, shots: [
        { id: 'sneeze', label: 'Sneeze', still: 'sneezing dramatically on a rooftop at sunset', motion: 'push-in then quick jolt' },
        { id: 'phone', label: 'Phone rings', still: 'answering a ringing phone on a bridge at night', motion: 'slow orbit' },
        { id: 'fall', label: 'Trips', still: 'tripping into a fountain in a plaza', motion: 'slow-motion splash' },
      ]},
    ],
  },
};

const { SAFETY_LINE } = require('./safety');

const STYLE = 'flat cel-shaded animation still, thick black outlines, bold flat shadows, cinematic framing, 16:9';

function keyframePrompt({ genre, scene, shot, cast, twist }) {
  const names = cast.map((c) => c.name).join(' and ');
  return [
    `A ${GENRES[genre].label.toLowerCase()} movie still.`,
    `${names}, exactly as drawn in the attached character references, ${shot.still}.`,
    twist ? `Twist: ${twist}.` : '',
    STYLE,
    'No text, no logos, no real brands.',
    SAFETY_LINE,
  ].filter(Boolean).join(' ');
}

function motionPrompt({ shot, twist }) {
  return [shot.motion, twist ? `Show this happening: ${twist}.` : '', 'cel-shaded animation, smooth motion, 5 seconds', 'family-friendly, safe for work'].filter(Boolean).join('. ');
}

module.exports = { GENRES, keyframePrompt, motionPrompt };
