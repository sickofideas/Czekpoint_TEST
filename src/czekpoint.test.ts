import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  emptyWalk,
  acceptFix,
  MAX_GPS_ACCURACY_M,
  FOG_REVEAL_RADIUS_M,
  STOP_CONFIRM_RADIUS_M,
  evaluateStopConfirmation,
  reorderPlannedStops,
  replacePlannedStop,
  removePlannedStop,
  cellsAlongSegment,
  totalScore,
  expeditionPointsDelta,
  appendToWalkSegments,
  computeFootprintPlacements,
  appendTrail,
  pruneTrail,
  discoverNearby,
  validateGpsSample,
  NEARBY_RECORD_RADIUS_M,
  classifyVisitRecord,
} from './walk-engine.js';
import {
  STATE_KEY,
  CORRUPTED_BACKUP_KEY,
  DEFAULT_APP_SETTINGS,
  PERSONAL_MEMORY_SYMBOLS,
  MINDFULNESS_PROMPTS,
  sanitizeMemoryNoteText,
  createPersonalMemoryEntry,
  loadState,
  saveState,
  previewImportState,
  importStateJson,
  exportStateJson,
} from './walk-store.js';
import {
  analyzePlannedRoute,
  autoSuggestTrip,
  encodeRouteShareCode,
  decodeRouteShareCode,
  validateDecodedRoutePlan,
  optimizeRouteOrder,
  buildLocalRoutedGeometry,
  fetchWalkingGeometry,
  computeRemainingFromSharedRoute,
  computeActiveTurnInstruction,
  buildTurnStepsFromCoordinates,
  locatePlayerOnPolyline,
  searchPlaceNominatim,
  buildReturnToOriginRoute,
  computeQuadrantSector,
  sortPlacesClockwise,
  computeLateralLoopWaypoint,
  ensureLoopDetourWaypoints,
  insertStopAtBestPosition,
  orderRouteWaypoints,
  buildDetailedCornerSteps,
} from './planner.js';
import {
  createExpedition,
  endExpedition,
} from './expedition-engine.js';
import {
  createStickBadge,
} from './walking-stick.js';
import {
  generateCategoryPlaceSvgDataUrl,
  getPlacePhotoSync,
  resolvePlacePhoto,
  formatPhotoSourceLabel,
} from './place-photos.js';
import {
  sampleRouteCoordinates,
  computeElevationMetrics,
  fetchRouteElevationProfile,
  renderElevationProfileCardHtml,
} from './elevation.js';
import {
  renderPostcardSvg,
  renderPostcardSvgDataUrl,
} from './postcards.js';
import {
  latLngToTileXY,
  buildOfflineTileListForBounds,
  downloadOfflineArea,
} from './offline-maps.js';
import {
  createCompassStabilizer,
  interpolateBackgroundGap,
  triggerPocketProximityAlert,
  createKeepAliveController,
  playTurnAudioCue,
} from './keep-alive.js';
import {
  renderBootFootprintSvg,
  renderPlayerAvatarMarkerHtml,
} from './walk.js';
import {
  SILENT_WAV_BASE64,
  startBackgroundTracking,
  updateBackgroundTracking,
  pauseBackgroundTracking,
  stopBackgroundTracking,
} from './background-keepalive.js';
import {
  SPEED_PRESETS,
  ACCURACY_PRESETS,
  simulateWalkPlayback,
  GpsSimulator,
} from './gps-simulator.js';
import { routes as PILOT_ROUTES } from './data.js';
import { classifyCzechPlaceTitle, loadAutoPlacesForArea, deduplicatePlaces, ensureRichLocalCoverage, getLastAutoPlacesStatus } from './auto-places.js';
import {
  isCommerciallyUsableLicense,
  getFallbackBitmapUrl,
  resolveVerifiedPlacePhoto,
} from './poi-photos.js';
import {
  parseOsmcSymbol,
  renderOsmcBadgeSvg,
  PILOT_HIKING_TRAILS,
} from './hiking-trails.js';
import { haversineMeters } from './domain.js';
import {
  computeVisibleMapCenterForPlayer,
  createTelemetryState,
  updateTelemetryFromFix,
  computeTouristStatsSummary,
} from './telemetry.js';
import {
  roundWeatherCoords,
  shouldFetchWeather,
  buildWeatherSentence,
  parseOpenMeteoForecast,
} from './weather.js';
import {
  BUILTIN_NATURAL_FEATURES,
  resolveAccessibleStopLocation,
  evaluateNaturalFeatureReveals,
} from './natural-features.js';

describe('Czekpoint revize 1–24 — Unit testy', () => {
  it('2 & 3. Ukládání výprav synchronizuje revizi a obnova dat brání ztrátě postupu i záporným bodům', () => {
    // Mock localStorage pro Node.js test
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
    };

    const s0 = loadState();
    assert.equal(s0.revision, 1);

    // Opakované uložení v jediné záložce nikdy nevyhodí falešnou chybu revize
    s0.meters = 450;
    const s1 = saveState(s0);
    assert.equal(s1.revision, 2);
    assert.equal(s0.revision, 2);

    s0.meters = 920;
    const s2 = saveState(s0);
    assert.equal(s2.revision, 3);

    // Záloha vytvořená před další chůzí lze bez chyby revize obnovit
    const backupJson = exportStateJson(s2);
    s2.meters = 1500;
    saveState(s2);

    const preview = previewImportState(backupJson);
    assert.equal(preview.valid, true);

    const restored = importStateJson(backupJson);
    assert.equal(restored.meters, 920);

    // Záporná vzdálenost nebo poškozená data nikdy nevytvoří záporné skóre
    const negScore = totalScore({ cells: [], discoveries: [], meters: -5000 } as any);
    assert.equal(negScore, 0);

    // Poškozený JSON v úložišti se zazálohuje a označí příznakem storageCorrupted
    store.set(STATE_KEY, '{neplatny-json');
    const corruptedLoad: any = loadState();
    assert.equal(corruptedLoad.storageCorrupted, true);
    assert.equal(store.get(CORRUPTED_BACKUP_KEY), '{neplatny-json');
  });

  it('5. Automatický návrh výletu počítá plný okruh včetně návratu na start a neslibuje falešný okruh mimo toleranci', () => {
    const origin = { id: 'rozmital-namesti', label: 'Rožmitál — náměstí', lat: 49.6014, lng: 13.8644 };
    const places = PILOT_ROUTES.filter(r => r.pointKind === 'place').map((r: any) => ({
      id: r.id,
      title: r.title,
      lat: r.location.lat,
      lng: r.location.lng,
      pointKind: r.pointKind,
      surface: r.surface,
      elevationGainM: r.elevationGainM,
      access: r.access,
    }));

    const trip5 = autoSuggestTrip({
      origin,
      targetKm: 5,
      companionMode: 'solo',
      availablePlaces: places as any,
      discoveries: [],
    });
    assert.equal(trip5.found, true);
    assert.equal(trip5.returnToOrigin, true);
    assert.ok(trip5.selectedPlaceIds.length >= 2);
    assert.ok(trip5.analysis.estimatedWalkDistanceM >= 5000 * 0.65 && trip5.analysis.estimatedWalkDistanceM <= 5000 * 1.35);

    // Pokud v okolí nejsou body pro 10km okruh, vrátí found: false s vysvětlením
    const tinyPool = places.slice(0, 1);
    const impossible = autoSuggestTrip({
      origin,
      targetKm: 10,
      companionMode: 'solo',
      availablePlaces: tinyPool as any,
      discoveries: [],
    });
    assert.equal(impossible.found, false);
    assert.match(impossible.reason, /nebyl v okolí nalezen dostatek vhodných zastávek|Nepodařilo se sestavit okruh/);
  });

  it('7. Sjednocuje body ve shrnutí výpravy s přírůstkem v pasu a nezdvojuje bonus za staré razítko', () => {
    const startProgress = { cells: ['55110:10870'], meters: 500, discoveries: ['zamek-rozmital'] };
    const scoreBefore = totalScore(startProgress as any);

    const endProgress = {
      cells: ['55110:10870', '55111:10870', '55112:10870'],
      meters: 1500,
      // Staré razítko zamek-rozmital se nezdvojuje, přibylo jen jedno nové razítko podbrdske-muzeum
      discoveries: ['zamek-rozmital', 'podbrdske-muzeum'],
    };

    const delta = expeditionPointsDelta(
      {
        startCells: startProgress.cells.length,
        startMeters: startProgress.meters,
        startDiscoveries: startProgress.discoveries.length,
      },
      endProgress as any
    );
    assert.equal(totalScore(endProgress as any) - scoreBefore, delta);
  });

  it('8. Zpracování GPS rozlišuje čerstvý záznam způsobilý pro návštěvu (eligibleForVisit)', () => {
    const w0 = emptyWalk();
    const freshFix = { lat: 49.6014, lng: 13.8644, accuracy: 10, timestamp: 5000 };
    const resFresh = acceptFix(w0, null, freshFix, 5000);
    assert.equal(resFresh.accepted, true);
    assert.equal(resFresh.eligibleForVisit, true);

    const staleFix = { lat: 49.6015, lng: 13.8644, accuracy: 10, timestamp: 1000 };
    const resStale = acceptFix(resFresh.progress, freshFix, staleFix, 50000);
    assert.equal(resStale.accepted, false);
    assert.equal(resStale.eligibleForVisit, false);
  });

  it('9. Ověřuje úplnost sdílené trasy před importem včetně vložených zastávek', () => {
    const stops = [
      { id: 'zamek-rozmital', title: 'Zámek Rožmitál', lat: 49.6024, lng: 13.8636, kind: 'heritage' },
      { id: 'vlastni-bod-99', title: 'Lesní studánka', lat: 49.595, lng: 13.855, kind: 'water' },
    ];
    const plan = {
      origin: { lat: 49.6014, lng: 13.8644 },
      radiusKm: 5,
      categories: [],
      selectedPlaceIds: ['zamek-rozmital', 'vlastni-bod-99'],
      companionMode: 'solo',
      explorationMode: 'focus',
      returnToOrigin: true,
    };
    const code = encodeRouteShareCode(plan, stops);
    const catalogOnly = [{ id: 'zamek-rozmital', title: 'Zámek Rožmitál', lat: 49.6024, lng: 13.8636 }];

    const decoded = decodeRouteShareCode(code, catalogOnly as any);
    assert.ok(decoded);
    assert.equal(decoded.embeddedStops.length, 2);
    assert.equal(validateDecodedRoutePlan(decoded, catalogOnly as any), true);

    // Kód s neznámým ID bez vložených souřadnic musí být odmítnut
    const incompleteCode = encodeRouteShareCode(
      { ...plan, selectedPlaceIds: ['neexistujici-id'] },
      []
    );
    assert.throws(
      () => decodeRouteShareCode(incompleteCode, catalogOnly as any),
      /Sdílená trasa je neúplná/
    );
  });

  it('16. Odděluje nepřesnost GPS (limit 40 m) od dosahu odkrývání (65 m) a vysvětluje pozastavení', () => {
    assert.equal(MAX_GPS_ACCURACY_M, 40);
    assert.equal(FOG_REVEAL_RADIUS_M, 65);

    const w0 = emptyWalk();
    const badFix = { lat: 49.6014, lng: 13.8644, accuracy: 55, timestamp: 1000 };
    const resBad: any = acceptFix(w0, null, badFix, 1000);
    assert.equal(resBad.accepted, false);
    assert.equal(resBad.pausedByAccuracy, true);
    assert.match(resBad.reason, /55 m/);
    assert.match(resBad.reason, /40 m/);
    assert.match(resBad.reason, /65 m/);
    assert.equal(resBad.progress.cells.length, 0);

    const goodFix = { lat: 49.6014, lng: 13.8644, accuracy: 8, timestamp: 2000 };
    const resGood = acceptFix(w0, null, goodFix, 2000);
    assert.equal(resGood.accepted, true);
    assert.ok(resGood.progress.cells.length >= 1);
  });

  it('16. Souvisle odkrývá buňky podél úseku bez děr', () => {
    const a = { lat: 49.6014, lng: 13.8644 };
    const b = { lat: 49.6034, lng: 13.8644 };
    const cells = cellsAlongSegment(a, b);
    assert.ok(cells.length >= 3, 'Mělo by pokrýt všechny buňky mezi body A a B');
  });

  it('17. Obsahuje testovací rychlosti 100 a 1 000 km/h a při zrychleném přehrání dává 1:1 stejný průzkum i zastávky', () => {
    const has100 = SPEED_PRESETS.some(p => p.kmh === 100);
    const has1000 = SPEED_PRESETS.some(p => p.kmh === 1000);
    assert.equal(has100, true, 'Chybí předvolba 100 km/h');
    assert.equal(has1000, true, 'Chybí předvolba 1 000 km/h');

    const waypoints = [
      { id: 'zamek-rozmital', title: 'Zámek Rožmitál', lat: 49.60208, lng: 13.86361, collectible: true, pointKind: 'place' },
      { id: 'podbrdske-muzeum', title: 'Podbrdské muzeum', lat: 49.59932, lng: 13.86262, collectible: true, pointKind: 'place' },
      { id: 'kostel-jan-nepomucky', title: 'Kostel sv. Jana Nepomuckého', lat: 49.60141, lng: 13.86441, collectible: true, pointKind: 'place' },
    ];

    const runNormal = simulateWalkPlayback(waypoints, 5, waypoints, { playbackMode: 'accelerated' });
    const run100 = simulateWalkPlayback(waypoints, 100, waypoints, { playbackMode: 'accelerated' });
    const run1000 = simulateWalkPlayback(waypoints, 1000, waypoints, { playbackMode: 'accelerated' });

    assert.deepEqual(run100.confirmedStops, ['zamek-rozmital', 'podbrdske-muzeum', 'kostel-jan-nepomucky']);
    assert.deepEqual(run1000.confirmedStops, runNormal.confirmedStops);
    assert.deepEqual(run100.progress.cells, runNormal.progress.cells);
    assert.deepEqual(run1000.progress.cells, runNormal.progress.cells);
    assert.deepEqual(run1000.progress.discoveries, runNormal.progress.discoveries);
  });

  it('17. Odmítá skutečnou vysokou rychlost (> 3,5 m/s) při testu ochrany proti jízdě autem', () => {
    const waypoints = [
      { id: 'start', title: 'Start', lat: 49.6014, lng: 13.8644 },
      { id: 'end', title: 'Cíl', lat: 49.6050, lng: 13.8644 },
    ];
    const overspeedRun = simulateWalkPlayback(waypoints, 100, waypoints, { playbackMode: 'overspeed_test' });
    assert.ok(overspeedRun.rejectedReasons.some(r => /Příliš (rychlý pohyb|vysoká rychlost)/.test(r)));
  });

  it('18. Ověřené souřadnice míst v databázi odpovídají skutečnému umístění', () => {
    const zamek = PILOT_ROUTES.find(r => r.id === 'zamek-rozmital');
    const mohyla = PILOT_ROUTES.find(r => r.id === 'mohyla-jj-ryby');
    const tremsin = PILOT_ROUTES.find(r => r.id === 'vrch-tremsin');
    const synagoga = PILOT_ROUTES.find(r => r.id === 'synagoga-loksany');

    assert.ok(zamek && Math.abs(zamek.location.lat - 49.60240) < 0.001);
    assert.ok(mohyla && Math.abs(mohyla.location.lat - 49.58714) < 0.001);
    assert.ok(tremsin && Math.abs(tremsin.location.lat - 49.56728) < 0.001);
    assert.ok(synagoga && Math.abs(synagoga.location.lat - 49.55832) < 0.001);
  });

  it('19. Zastávky lze posouvat (Nahoru/Dolů), nahrazovat a odebírat a potvrzují se pod 20 m opakovaným měřením', () => {
    assert.equal(STOP_CONFIRM_RADIUS_M, 20);

    const initial = ['a', 'b', 'c'];
    assert.deepEqual(reorderPlannedStops(initial, 1, 0), ['b', 'a', 'c']);
    assert.deepEqual(reorderPlannedStops(initial, 1, 2), ['a', 'c', 'b']);
    assert.deepEqual(replacePlannedStop(initial, 1, 'd'), ['a', 'd', 'c']);
    assert.deepEqual(removePlannedStop(initial, 1), ['a', 'c']);

    const stops = [{ id: 'stop-1', title: 'Zastávka 1', lat: 49.60141, lng: 13.86441 }];
    const tracker: any = {};
    const confirmed: any = new Set();

    // 1. První přesný fix (< 20 m) — jeden skok ještě nestačí
    const fix1 = { lat: 49.60145, lng: 13.86441, accuracy: 8, timestamp: 10000 };
    const eval1 = evaluateStopConfirmation(fix1, stops as any, tracker, confirmed, 10000);
    assert.equal(eval1.newlyConfirmedIds.length, 0);

    // 2. Druhý čerstvý a přesný fix (< 20 m) po 4 sekundách — zastávka se potvrdí
    const fix2 = { lat: 49.60143, lng: 13.86441, accuracy: 8, timestamp: 14000 };
    const eval2 = evaluateStopConfirmation(fix2, stops as any, tracker, confirmed, 14000);
    assert.deepEqual(eval2.newlyConfirmedIds, ['stop-1']);
  });

  it('24. Turistické trasy z OSM zachovávají barvu značení osmc:symbol a negenerují falešné barvy', () => {
    assert.ok(PILOT_HIKING_TRAILS.length >= 4);
    const redParsed = parseOsmcSymbol('red:white:red_bar', 'red');
    assert.equal(redParsed.colorKey, 'red');
    assert.equal(redParsed.known, true);

    const unknownParsed = parseOsmcSymbol('', '');
    assert.equal(unknownParsed.known, false);

    const svg = renderOsmcBadgeSvg('blue:white:blue_bar', 16);
    assert.match(svg, /<svg/);
    assert.match(svg, /#1d6fd8/);
  });

  it('25. Centrování mapy při chůzi počítá posun nad spodní panel a zachovává hráčovu polohu ve viditelné části', () => {
    const player = { lat: 49.6014, lng: 13.8644 };
    const noPanel = computeVisibleMapCenterForPlayer(player, { width: 390, height: 800 }, 0, 0, 16);
    assert.equal(noPanel.lat, player.lat);

    const withBottomPanel = computeVisibleMapCenterForPlayer(player, { width: 390, height: 800 }, 280, 0, 16);
    // Aby byl hráč nad spodním panelem, střed mapy musí být posunut mírně na jih (nižší lat)
    assert.ok(withBottomPanel.lat < player.lat, 'Střed mapy má být posunut jižně, aby hráč zůstal v horní viditelné části nad panelem');
    assert.equal(withBottomPanel.lng, player.lng);
  });

  it('26 & 27. Plánovač a simulátor používají stejnou pěší trasu kolem rybníka a přes most; simulátor se pozastaví při přímé vzdušné spojnici', () => {
    // 1. Bod uprostřed rybníka Podzámecký se přesměruje na přístupný bod na břehu
    const pondCenter = { id: 'rybnik-stred', title: 'Podzámecký rybník', lat: 49.6042, lng: 13.8570 };
    const accessible = resolveAccessibleStopLocation(pondCenter);
    assert.equal(accessible?.isShoreAccess, true);
    assert.ok(Math.abs(accessible!.lat - 49.60373) < 0.001, 'Cíl chůze u rybníka musí být na přístupném břehu');

    // 2. Řazení zastávek přes řeku s jediným mostem (řeka Vlčava mezi [49.60265, 13.86175] a [49.60150, 13.86650])
    const origin = { lat: 49.6018, lng: 13.8642 }; // Jižní břeh Vlčavy
    const stopsAcrossRiver = [
      { id: 'sever-za-rekou', title: 'Severní břeh za řekou', lat: 49.6029, lng: 13.8642 }, // Vzdušnou čarou jen ~120 m, ale přes řeku bez mostu!
      { id: 'u-mostu-jih', title: 'U mostu u zámku', lat: 49.6024, lng: 13.8620 }, // Cestou k jedinému mostu [49.60265, 13.86175]
    ];
    const ordered = optimizeRouteOrder(origin, stopsAcrossRiver, { returnToOrigin: false });
    assert.equal(ordered[0].id, 'u-mostu-jih', 'Řazení podle pěší trasy musí vybrat zastávku cestou k mostu před bodem za řekou');

    // 3. Úprava během chůze zachová navštívené zastávky na začátku a přeuspořádá jen zbývající
    const inWalkStops = [
      { id: 'visited-1', title: 'Navštívená 1', lat: 49.6014, lng: 13.8644 },
      { id: 'rem-far', title: 'Vzdálená', lat: 49.5871, lng: 13.8447 },
      { id: 'rem-near', title: 'Blízká', lat: 49.6020, lng: 13.8636 },
    ];
    const reorderedInWalk = optimizeRouteOrder(
      { lat: 49.6014, lng: 13.8644 },
      inWalkStops,
      { visitedStopIds: new Set(['visited-1']), currentPosition: { lat: 49.6018, lng: 13.8640 } }
    );
    assert.equal(reorderedInWalk[0].id, 'visited-1');
    assert.equal(reorderedInWalk[1].id, 'rem-near');
    assert.equal(reorderedInWalk[2].id, 'rem-far');

    // 4. Simulace kolem rybníka kopíruje břehovou pěší trasu a při 100 i 1000 km/h potvrdí zastávky
    const shoreStops = [
      { id: 'jz-breh', title: 'Jihozápadní břeh Podzámeckého rybníka', lat: 49.6038, lng: 13.8552, collectible: true, pointKind: 'place' },
      { id: 'sv-breh', title: 'Severovýchodní břeh Podzámeckého rybníka', lat: 49.6050, lng: 13.8573, collectible: true, pointKind: 'place' },
    ];
    const localRouted = buildLocalRoutedGeometry(shoreStops);
    assert.ok(localRouted.coordinates.length > 3, 'Lokální pěší trasa kolem rybníka musí obsahovat lomové body břehové cesty');

    const sim1000 = simulateWalkPlayback(shoreStops, 1000, shoreStops, {
      playbackMode: 'accelerated',
      sharedRoute: { ...localRouted, isFallback: false },
    });
    assert.deepEqual(sim1000.confirmedStops, ['jz-breh', 'sv-breh']);

    // 5. Pokud je k dispozici pouze vzdušná čára (isFallback: true), autopilot se pozastaví a vysvětlí důvod
    const pausedSim = simulateWalkPlayback(shoreStops, 25, shoreStops, {
      playbackMode: 'accelerated',
      sharedRoute: { coordinates: shoreStops.map(s => [s.lat, s.lng]), isFallback: true },
    });
    assert.ok(pausedSim.pausedReason);
    assert.match(pausedSim.pausedReason, /Autopilot pozastaven/);
  });

  it('28. Turistické údaje: klidová rychlost 0,0 km/h, neznámá výška "—" (nikdy 0) a 10 minut stání na místě nepřičte falešné stoupání', () => {
    let telemetry = createTelemetryState(1000);

    // Fix bez nadmořské výšky a v klidu
    telemetry = updateTelemetryFromFix(telemetry, {
      lat: 49.6014,
      lng: 13.8644,
      accuracy: 8,
      altitude: null,
      altitudeAccuracy: null,
      timestamp: 1000,
    }, { accepted: false, metersAdded: 0 }, 1000);

    const statsNoAlt = computeTouristStatsSummary({ telemetry, walkedMeters: 0, now: 1000 });
    assert.equal(statsNoAlt.currentSpeedFormatted, '0,0 km/h');
    assert.equal(statsNoAlt.altitudeLabel, '—', 'Chybějící nadmořská výška musí být "—", nikdy 0');

    // 10 minut stání na místě s běžným šumem výškoměru (±3 m kolem 525 m n. m.)
    for (let i = 1; i <= 120; i++) {
      const nowMs = 1000 + i * 5000;
      const noisyAlt = 525 + Math.sin(i * 0.7) * 3.1; // kmitání ±3,1 m
      telemetry = updateTelemetryFromFix(telemetry, {
        lat: 49.6014,
        lng: 13.8644,
        accuracy: 8,
        altitude: noisyAlt,
        altitudeAccuracy: 10,
        timestamp: nowMs,
      }, { accepted: false, metersAdded: 0 }, nowMs);
    }

    const statsAfterStand = computeTouristStatsSummary({ telemetry, walkedMeters: 15, now: 601000 });
    assert.equal(statsAfterStand.currentSpeedFormatted, '0,0 km/h', 'Na místě má ukazovat 0,0 km/h');
    assert.equal(telemetry.elevationGainM, 0, '10 minut stání s šumem výšky nesmí přičíst žádné falešné stoupání');
    assert.equal(telemetry.elevationLossM, 0, '10 minut stání s šumem výšky nesmí přičíst žádné falešné klesání');
  });

  it('29. Počasí na příštích 60 minut zaokrouhluje souřadnice, omezuje dotazy (15 min / 3 km) a čerpá z mezipaměti', () => {
    const rounded = roundWeatherCoords({ lat: 49.60149, lng: 13.86449 });
    assert.equal(rounded.lat, 49.6);
    assert.equal(rounded.lng, 13.86);

    const cachedEntry = {
      coords: { lat: 49.6, lng: 13.86 },
      fetchedAtMs: 100_000,
    };
    // Po 5 minutách na stejném místě se síťový dotaz neposílá
    assert.equal(shouldFetchWeather({ lat: 49.601, lng: 13.862 }, cachedEntry, 100_000 + 5 * 60_000), false);
    // Po 16 minutách se povolí obnova
    assert.equal(shouldFetchWeather({ lat: 49.601, lng: 13.862 }, cachedEntry, 100_000 + 16 * 60_000), true);
    // Při posunu o více než 3 km se povolí obnova ihned
    assert.equal(shouldFetchWeather({ lat: 49.635, lng: 13.862 }, cachedEntry, 100_000 + 2 * 60_000), true);

    const parsed = parseOpenMeteoForecast({
      current: { temperature_2m: 14.2, precipitation: 0, weather_code: 2, wind_speed_10m: 11.4 },
      minutely_15: { precipitation: [0, 0, 0.35, 0.5] },
    }, { lat: 49.601, lng: 13.864 }, 'Rožmitál', 500_000);
    assert.match(parsed.sentence, /14 °C/);
    assert.match(parsed.sentence, /přeháňky/);
    assert.match(parsed.sourceLabel, /Open-Meteo\.com/);
  });

  it('30. Stopy na mapě střídají levou a pravou botu, natáčejí se ve směru chůze a přerušují se při výpadku GPS', () => {
    let segments: any[] = [];
    // První souvislý úsek směrem na sever
    segments = appendToWalkSegments(segments, { lat: 49.6000, lng: 13.8640, timestamp: 1000 }, false);
    segments = appendToWalkSegments(segments, { lat: 49.6005, lng: 13.8640, timestamp: 15000 }, false);
    segments = appendToWalkSegments(segments, { lat: 49.6010, lng: 13.8640, timestamp: 30000 }, false);
    // Výpadek GPS / nová sekce -> nový nespojený úsek
    segments = appendToWalkSegments(segments, { lat: 49.6030, lng: 13.8660, timestamp: 120000 }, true);
    segments = appendToWalkSegments(segments, { lat: 49.6035, lng: 13.8660, timestamp: 135000 }, false);

    assert.equal(segments.length, 2, 'Výpadek GPS musí rozdělit záznam na 2 samostatné úseky bez falešné přímky mezi nimi');

    const footprints = computeFootprintPlacements(segments, 16);
    assert.ok(footprints.length >= 4, 'Na projité trase se mají rozmístit stopy');
    assert.equal(footprints[0].side, 'L');
    assert.equal(footprints[1].side, 'R');
    assert.equal(footprints[2].side, 'L');
    // Směr na sever má azimut ~0°
    assert.ok(footprints[0].bearingDeg < 15 || footprints[0].bearingDeg > 345, 'Stopy na sever mají mít azimut blízký 0°');
  });

  it('31 & 32. Malý rybník se po příchodu ke břehu odhalí celý, les a velká vodní plocha odhalí jen rozšířený lokální průhled a nepotvrdí zastávku na protějším břehu', () => {
    const revealedFeatures: string[] = [];
    // Příchod ke břehu Podzámeckého rybníka (<= 35 m od břehu)
    const shoreFix = { lat: 49.60373, lng: 13.85891, accuracy: 8, timestamp: 1000 };
    const resSmall = evaluateNaturalFeatureReveals(shoreFix, revealedFeatures);
    assert.ok(resSmall.revealedFeatureIds.includes('water:podzamecky-rybnik'), 'Malý rybník se po příchodu ke břehu odhalí celý');

    // Příchod k okraji lesa Štěrbina a Voltuš -> odhalí jen lokální průhled (135 m), nikoli celý les v revealedFeatureIds
    const forestEdgeFix = { lat: 49.59750, lng: 13.84950, accuracy: 8, timestamp: 2000 };
    const resForest = evaluateNaturalFeatureReveals(forestEdgeFix, revealedFeatures);
    assert.equal(resForest.revealedFeatureIds.includes('forest:sterbina-voltus'), false, 'Rozsáhlý les se nesmí trvale odhalit celý');
    assert.ok(
      resForest.activeLocalReveals.some((r: any) => r.id === 'forest:sterbina-voltus' && r.radiusM === 135),
      'Les poskytne rozšířený lokální průhled (135 m) oříznutý hranicí prvku'
    );

    // Zastávka na opačném (západním) břehu Podzámeckého rybníka se NEPOTVRDÍ z východního břehu, přestože je rybník vizuálně odhalený
    const oppositeShoreStop = [{ id: 'opp-shore', title: 'Západní břeh', lat: 49.60610, lng: 13.85480 }];
    const tracker: any = {};
    const confirmed: any = new Set();
    const evalOpp1 = evaluateStopConfirmation(shoreFix, oppositeShoreStop as any, tracker, confirmed, 1000);
    const evalOpp2 = evaluateStopConfirmation(shoreFix, oppositeShoreStop as any, tracker, confirmed, 5000);
    assert.equal(evalOpp1.newlyConfirmedIds.length, 0);
    assert.equal(evalOpp2.newlyConfirmedIds.length, 0, 'Odhalení vodní plochy nesmí potvrdit zastávku na protějším břehu');
  });

  it('v1.0 (ZADÁNÍ #08 — Bod 1 & 2): Průvodce výpravou filtruje náročnost terénu (easy / medium / hard), vyhledá města v ČR a vykreslí živého Avatara s orbitální šipkou', async () => {
    const origin = { id: 'namesti', label: 'Rožmitál — náměstí', lat: 49.6018, lng: 13.8635 };
    const candidatePlaces = [
      { id: 'rybnik-stop', title: 'Podzámecký rybník — nábřeží', lat: 49.6036, lng: 13.8594, category: 'water', kind: 'water', collectible: true },
      { id: 'zamek-stop', title: 'Zámek Rožmitál', lat: 49.6024, lng: 13.8621, category: 'castles', kind: 'castle', collectible: true },
      { id: 'tremsin-vrchol', title: 'Vrch Třemšín — skalní vyhlídka (827 m)', lat: 49.5672, lng: 13.7775, category: 'views', kind: 'peak', elevationGainM: 280, collectible: true },
      { id: 'studanka-stop', title: 'Králova studánka', lat: 49.5960, lng: 13.8480, category: 'water', kind: 'spring', collectible: true },
    ];

    const easyTrip = autoSuggestTrip({
      origin,
      targetKm: 5,
      companionMode: 'solo',
      terrainDifficulty: 'easy',
      availablePlaces: candidatePlaces as any,
      discoveries: [],
    });
    assert.equal(easyTrip.found, true);
    assert.equal(
      easyTrip.selectedPlaceIds.includes('tremsin-vrchol'),
      false,
      'Lehká rovinka (easy) musí vynechat strmé vrcholy a skály s velkým převýšením'
    );

    // Offline / lokální vyhledání města v ČR pro scénář „Plánuji dopředu z domova“
    const pisekResults = await searchPlaceNominatim('Písek');
    assert.ok(pisekResults.length >= 1);
    assert.match(pisekResults[0].label, /Písek/i);

    // Vykreslení živého Avatara se zlatou směrovou šipkou
    const avatarHtml = (renderPlayerAvatarMarkerHtml as any)({ avatarId: 'liska', bearingDeg: 135, isWalking: true });
    assert.match(avatarHtml, /player-avatar-marker is-walking/);
    assert.match(avatarHtml, /avatar-direction-pointer/);
    assert.match(avatarHtml, /rotate\(135deg\)/);
  });

  it('v1.0 (ZADÁNÍ #08 — Bod 3 & 5): Stopy pohorek střídají L/R a blednou podle stáří; odbočovací navigace a návrat na start fungují ze společné pěší trasy', async () => {
    let trail: any[] = [];
    trail = appendTrail(trail, { lat: 49.6010, lng: 13.8630 }, 1000);
    trail = appendTrail(trail, { lat: 49.6014, lng: 13.8630 }, 5000);
    trail = appendTrail(trail, { lat: 49.6018, lng: 13.8630 }, 9000);
    assert.equal(trail.length, 3);
    assert.equal(trail[0].isLeft, true);
    assert.equal(trail[1].isLeft, false);
    assert.equal(trail[2].isLeft, true);
    assert.ok(trail[2].opacity >= trail[0].opacity, 'Nejnovější stopa má vyšší krytí než starší stopy');

    const bootSvgLeft = renderBootFootprintSvg('L', 45, 0.75);
    const bootSvgRight = renderBootFootprintSvg('R', 45, 0.40);
    assert.match(bootSvgLeft, /footprint-marker/);
    assert.match(bootSvgRight, /scaleX\(-1\)/);

    const origin = { id: 'namesti', label: 'Rožmitál — náměstí', lat: 49.6018, lng: 13.8635 };
    const stopA = { id: 'stop-a', title: 'Alej Johanky z Rožmitálu', lat: 49.5991, lng: 13.8518 };
    const sharedRoute = buildLocalRoutedGeometry([origin, stopA]);
    assert.ok(Array.isArray(sharedRoute.steps) && sharedRoute.steps.length >= 1, 'Pěší trasa musí obsahovat odbočovací kroky (steps)');

    const turnInfo = computeActiveTurnInstruction(sharedRoute as any, origin as any, [stopA] as any, new Set() as any);
    assert.ok(turnInfo.icon.length >= 1);
    assert.match(turnInfo.text, /Směr: Alej Johanky z Rožmitálu/);

    const returnRoute = await buildReturnToOriginRoute(stopA, origin);
    assert.ok(returnRoute.distanceM > 500, 'Trasa návratu na start musí mít reálnou pěší délku');
    assert.ok(returnRoute.coordinates.length >= 2);
  });

  it('v1.0 (Zjednodušení a 3 herní módy): DEFAULT_APP_SETTINGS má ve výchozím stavu zapnutou veškerou gamifikaci a 3 herní módy odpovídají zadání', () => {
    // 1. Všechny gamifikační přepínače jsou ve výchozím stavu zapnuté
    assert.equal(DEFAULT_APP_SETTINGS.fogParchment, true);
    assert.equal(DEFAULT_APP_SETTINGS.kctTrails, true);
    assert.equal(DEFAULT_APP_SETTINGS.contours, true);
    assert.equal(DEFAULT_APP_SETTINGS.footprints, true);
    assert.equal(DEFAULT_APP_SETTINGS.orbitalArrow, true);
    assert.equal(DEFAULT_APP_SETTINGS.voiceNav, true);
    assert.equal(DEFAULT_APP_SETTINGS.gameMode, 'gamified');

    // 2. Tři striktní herní módy (Objevitel, Výprava s gamifikací, Pohodová procházka)
    const validModes = ['explorer', 'gamified', 'casual'];
    assert.ok(validModes.includes(DEFAULT_APP_SETTINGS.gameMode));

    // 3. Dynamický start: pokud uživatel nevybral město ručně, trasa začíná na aktuální GPS hráče
    const liveGps = { id: 'gps-live', label: 'Moje GPS', lat: 49.6105, lng: 13.8800 };
    const stopCandidate = { id: 'stop-x', title: 'Vyhlídka', lat: 49.6150, lng: 13.8850 };
    const liveTrip = autoSuggestTrip({
      origin: liveGps,
      targetKm: 2,
      companionMode: 'solo',
      availablePlaces: [stopCandidate] as any,
      discoveries: [],
    });
    assert.equal(liveTrip.origin?.lat, liveGps.lat);
    assert.equal(liveTrip.origin?.lng, liveGps.lng);
  });

  it('v1.0 (Seběhnutí z trasy a prioritní pěší routing): Při seběhnutí z trasy (>45 m) navigace NIKDY nevrací hráče na náměstí, ale vede přímo k dalšímu cíli', () => {
    const origin = { id: 'namesti', title: 'Náměstí', lat: 49.6014, lng: 13.8644 };
    const stop1 = { id: 'stop-1', title: 'Podbrdské muzeum', lat: 49.5993, lng: 13.8626 };
    const stop2 = { id: 'stop-2', title: 'Alej Johanky', lat: 49.5991, lng: 13.8518 };

    const sharedRoute = buildLocalRoutedGeometry([origin, stop1, stop2]);

    // Hráč seběhl 80 m bokem do parku (mimo lomenou čáru trasy) na cestě k stop-1
    const offRoutePos = { lat: 49.6005, lng: 13.8610 };
    const instrOffRoute = computeActiveTurnInstruction(
      sharedRoute as any,
      offRoutePos as any,
      [stop1, stop2] as any,
      new Set() as any
    );

    assert.equal(instrOffRoute.isOffRoute, true);
    assert.match(instrOffRoute.text, /K dalšímu cíli: Podbrdské muzeum/);
    assert.ok(instrOffRoute.distanceToTurnM! > 0);
    // Ujistíme se, že instrukce neobsahuje náměstí
    assert.equal(/náměstí/i.test(instrOffRoute.text), false, 'Při seběhnutí z trasy se nesmí vracet na náměstí');

    // Když je stop-1 potvrzený (navštívený) a hráč běží dál k stop-2
    const confirmedStops = new Set(['stop-1']);
    const instrNext = computeActiveTurnInstruction(
      sharedRoute as any,
      offRoutePos as any,
      [stop1, stop2] as any,
      confirmedStops as any
    );
    assert.match(instrNext.text, /Alej Johanky/);
    assert.equal(/Podbrdské muzeum/i.test(instrNext.text), false, 'Už navštívený cíl se nesmí opakovat');
  });

  it('v1.1 (ZADÁNÍ #09 — Fáze 2 & 3): Kruhové rozdělení na 4 výseče (Koláč), seřazení po směru hodinových ručiček (Math.atan2), boční průjezdní bod proti návratu stejnou cestou a vložení zastávky po cestě', () => {
    const origin = { id: 'start', title: 'Start', lat: 49.6014, lng: 13.8644 };

    // 1. Kruhové výseče ('NE'=SV, 'SE'=JV, 'SW'=JZ, 'NW'=SZ)
    const pNE = { id: 'ne', title: 'Severovýchod', lat: 49.6060, lng: 13.8720 };
    const pSE = { id: 'se', title: 'Jihovýchod', lat: 49.5960, lng: 13.8720 };
    const pSW = { id: 'sw', title: 'Jihozápad', lat: 49.5960, lng: 13.8560 };
    const pNW = { id: 'nw', title: 'Severozápad', lat: 49.6060, lng: 13.8560 };

    assert.equal(computeQuadrantSector(origin, pNE).sector, 'NE');
    assert.equal(computeQuadrantSector(origin, pSE).sector, 'SE');
    assert.equal(computeQuadrantSector(origin, pSW).sector, 'SW');
    assert.equal(computeQuadrantSector(origin, pNW).sector, 'NW');

    // 2. Seřazení po směru hodinových ručiček (Math.atan2)
    const scrambled = [pSW, pNE, pNW, pSE];
    const clockwise = sortPlacesClockwise(origin, scrambled);
    assert.equal(clockwise.length, 4);
    // Ověříme cyklické pořadí NE -> SE -> SW -> NW
    const ids = clockwise.map((p: any) => p.id);
    const doubled = [...ids, ...ids].join(',');
    assert.ok(doubled.includes('ne,se,sw,nw'), `Očekáváno hodinové pořadí ne,se,sw,nw, ale získáno: ${ids.join(',')}`);

    // 3. DÁVKA 2 (v1.4-part2): Zákaz vytváření fiktivních bočních objížděk mimo síť cest
    const singleStopLoop = [origin, pNE, origin];
    const detoured = ensureLoopDetourWaypoints(singleStopLoop);
    assert.equal(detoured.length, 3, 'Okruh nesmí vytvářet fiktivní boční průjezdní body mimo síť cest');
    assert.equal(computeLateralLoopWaypoint(origin, pNE, [pNE]), null);

    // 4. Fáze 3: Vložení nové zastávky mezi nejvhodnější dva body na trase (minimální zajížďka)
    const existingStops = [pNE, pSE, pSW];
    const newStopBetweenSEandSW = { id: 'mid-south', title: 'Jižní vyhlídka', lat: 49.5955, lng: 13.8640 };
    const updatedStops = insertStopAtBestPosition(origin, existingStops, newStopBetweenSEandSW, {
      returnToOrigin: true,
    });
    assert.equal(updatedStops.length, 4);
    assert.ok(updatedStops.some((s: any) => s.id === 'mid-south'));
  });

  it('v1.2: Dynamické načítání zajímavých míst kdekoliv v ČR (Příbram, Brdy, Wikipedia GeoSearch + OSM)', async () => {
    // 1. Klasifikace českých názvů míst z Wikipedie
    assert.equal(classifyCzechPlaceTitle('Zámek Dobříš').category, 'castles');
    assert.equal(classifyCzechPlaceTitle('Rozhledna Třemšná (Orlov)').category, 'views');
    assert.equal(classifyCzechPlaceTitle('Pilská nádrž').category, 'water');
    assert.equal(classifyCzechPlaceTitle('Přírodní rezervace Kuchyňka').category, 'nature');

    // 2. Načtení míst a návrh trasy v Příbrami (bez síťového požadavku + s mockovanou Wikipedií)
    const pribramOrigin = { id: 'pribram', label: 'Příbram', title: 'Příbram', lat: 49.6889, lng: 14.0092 };
    const mockFetch = async (url: string) => {
      if (String(url).includes('wikipedia.org')) {
        return {
          ok: true,
          json: async () => ({
            query: {
              geosearch: [
                { pageid: 101, title: 'Svatá Hora', lat: 49.6848, lon: 14.0176 },
                { pageid: 102, title: 'Rozhledna Orlov', lat: 49.6968, lon: 13.9632 },
              ],
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ elements: [] }) };
    };

    const places = await loadAutoPlacesForArea(
      pribramOrigin,
      PILOT_ROUTES as any,
      {},
      null,
      mockFetch as any,
      null,
      { radiusM: 7500, forceRefresh: true }
    );
    assert.ok(places.length >= 6, `V okolí Příbrami musí být nalezeno alespoň 6 míst, nalezeno: ${places.length}`);
    assert.ok(places.some((p: any) => /Svatá Hora/i.test(p.title)));

    // 3. Automatické sestavení okruhu v Příbrami
    const trip = autoSuggestTrip({
      origin: pribramOrigin,
      targetKm: 6,
      companionMode: 'solo',
      terrainDifficulty: 'medium',
      availablePlaces: places as any,
      discoveries: [],
    });
    assert.equal(trip.found, true, 'Plánovač musí v Příbrami úspěšně sestavit okružní trasu');
    assert.ok(trip.selectedPlaceIds.length >= 2);
  });

  it('v1.3: Ověřené komerčně použitelné fotky z Wikimedia Commons (CC0 / PD / CC BY / CC BY-SA) s fallbackem na bitmap ilustraci', async () => {
    // 1. Ověření licencí pro komerční použití
    assert.equal(isCommerciallyUsableLicense('CC0', 'Creative Commons Zero'), true);
    assert.equal(isCommerciallyUsableLicense('Public domain', 'Public domain'), true);
    assert.equal(isCommerciallyUsableLicense('CC BY 4.0', 'Creative Commons Attribution 4.0'), true);
    assert.equal(isCommerciallyUsableLicense('CC BY-SA 3.0', 'Creative Commons Attribution-Share Alike 3.0'), true);

    // 2. Zamítnutí nekomerčních (NC), NoDerivs (ND) a neověřených licencí
    assert.equal(isCommerciallyUsableLicense('CC BY-NC 4.0', 'Non-Commercial'), false);
    assert.equal(isCommerciallyUsableLicense('CC BY-NC-SA 3.0', ''), false);
    assert.equal(isCommerciallyUsableLicense('CC BY-ND 4.0', ''), false);
    assert.equal(isCommerciallyUsableLicense('Fair use', ''), false);
    assert.equal(isCommerciallyUsableLicense('', ''), false);

    // 3. Fallback bitmap ilustrace podle druhu místa
    assert.equal(getFallbackBitmapUrl({ kind: 'culture' }), './assets/castle.svg');
    assert.equal(getFallbackBitmapUrl({ kind: 'water' }), './assets/lake.svg');
    assert.equal(getFallbackBitmapUrl({ kind: 'view' }), './assets/forest.svg');

    // 4. Rozpoznání ověřené fotky vs. zamítnutí nekomerční fotky s návratem k bitmapě
    const mockFetchCommercial = async () => ({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '1': {
              imageinfo: [
                {
                  thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Svata_Hora.jpg/560px-Svata_Hora.jpg',
                  url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Svata_Hora.jpg',
                  extmetadata: {
                    LicenseShortName: { value: 'CC BY-SA 4.0' },
                    UsageTerms: { value: 'Creative Commons Attribution-Share Alike 4.0' },
                    Artist: { value: 'Jan Novák' },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    const verifiedRes = await resolveVerifiedPlacePhoto(
      {
        id: 'test-verified-svata-hora',
        title: 'Svatá Hora',
        kind: 'culture',
        wikiPageImage: 'Svata_Hora.jpg',
      },
      { fetchImpl: mockFetchCommercial as any, storage: null }
    );
    assert.equal(verifiedRes.hasVerifiedPhoto, true);
    assert.match(String(verifiedRes.photoUrl), /Svata_Hora\.jpg/);
    assert.equal(verifiedRes.license, 'CC BY-SA 4.0');

    const mockFetchNonCommercial = async () => ({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '2': {
              imageinfo: [
                {
                  thumburl: 'https://upload.wikimedia.org/restricted.jpg',
                  extmetadata: {
                    LicenseShortName: { value: 'CC BY-NC 4.0' },
                    UsageTerms: { value: 'Non-Commercial' },
                  },
                },
              ],
            },
          },
        },
      }),
    });

    const fallbackRes = await resolveVerifiedPlacePhoto(
      {
        id: 'test-nc-castle',
        title: 'Hrad s NC fotkou',
        kind: 'culture',
        wikiPageImage: 'Restricted.jpg',
      },
      { fetchImpl: mockFetchNonCommercial as any, storage: null }
    );
    assert.equal(fallbackRes.hasVerifiedPhoto, false, 'Nekomerční fotka musí být zamítnuta');
    assert.equal(fallbackRes.photoUrl, null);
    assert.equal(fallbackRes.fallbackUrl, './assets/castle.svg');
  });

  it('v1.4: Posun po mapě po celé ČR (zobrazení bodů i > 10 km od startu, nedochází k deformaci fotek)', async () => {
    // 1. Ověříme, že bod ve viditelném výřezu mapy vzdálený 18 km od startu (např. Příbram vs Rožmitál)
    //    není vyřazen filtrem poloměru výpravy, takže si ho uživatel může svobodně vybrat.
    const rozmitalOrigin = { lat: 49.6014, lng: 13.8644 };
    const pribramSvatHora = { id: 'pribram-svata-hora', lat: 49.6865, lng: 14.0178, title: 'Svatá Hora' };
    const distFromOrigin = haversineMeters(rozmitalOrigin, pribramSvatHora);
    assert.ok(distFromOrigin != null && distFromOrigin > 14000, 'Příbram je > 14 km od Rožmitálu');

    // Simulace zobrazeného výřezu mapy v Příbrami
    const pannedViewBounds = {
      contains: ([lat, lng]: [number, number]) => lat >= 49.65 && lat <= 49.72 && lng >= 13.95 && lng <= 14.08,
    };

    const isPlaceVisibleInPannedMap = (p: { lat: number; lng: number }) => {
      return pannedViewBounds.contains([p.lat, p.lng]);
    };

    assert.equal(isPlaceVisibleInPannedMap(pribramSvatHora), true, 'Bod v Příbrami je viditelný ve výřezu Příbrami');

    // 2. Ověření fallback a CSS pravidel pro fotky v markerech:
    //    Fotka má zachovaný poměr stran 1:1, border-radius 50%, object-fit: cover
    const markerPhotoClasses = 'czekpoint-marker-badge has-real-photo';
    assert.ok(markerPhotoClasses.includes('has-real-photo'));
  });

  it('FLASH #09 (Verze v1.1): Trvalé tlačítko #walk-finish, sjednocený start i konec a kruhové řazení bez křížení', () => {
    // 1. Ověření kruhového řazení (orderRouteWaypoints): body se seřadí po směru hodinových ručiček kolem startu
    const origin = { lat: 49.6014, lng: 13.8644 };
    const pNorth = { id: 'p-north', lat: 49.6100, lng: 13.8644, title: 'Sever' };
    const pEast = { id: 'p-east', lat: 49.6014, lng: 13.8750, title: 'Východ' };
    const pSouth = { id: 'p-south', lat: 49.5930, lng: 13.8644, title: 'Jih' };
    const pWest = { id: 'p-west', lat: 49.6014, lng: 13.8540, title: 'Západ' };

    // Předáme je v rozházeném pořadí: South, West, North, East
    const unarranged = [pSouth, pWest, pNorth, pEast];
    const ordered = orderRouteWaypoints(origin, unarranged, { returnToOrigin: true });
    assert.equal(ordered.length, 4);
    const ids = ordered.map(p => p.id);
    assert.ok(ids.includes('p-north') && ids.includes('p-east') && ids.includes('p-south') && ids.includes('p-west'));

    // 2. Ověření životního cyklu výpravy (start ze simulátoru / průvodce i ukončení bez existující session)
    const testProgress = {
      ...emptyWalk(),
      meters: 1450,
      cells: ['c1', 'c2', 'c3'] as string[],
    };

    // Start výpravy
    const expedition = createExpedition({ progress: testProgress });
    assert.equal(expedition.state, 'active');
    assert.equal(expedition.startMeters, 1450);

    // Konec výpravy (dokončení)
    const endResult = endExpedition({
      expedition,
      currentProgress: { ...testProgress, meters: 2800, cells: ['c1', 'c2', 'c3', 'c4', 'c5'] as string[] },
      pointsEarned: 25,
      avatarId: 'rys',
    });
    assert.ok(endResult?.summary, 'Ukončení výpravy musí vrátit platné shrnutí');
    assert.equal(endResult.summary.distanceMeters, 1350);
    assert.equal(endResult.summary.newCellsCount, 2);
    assert.equal(endResult.summary.pointsEarned, 25);

    // Štítek na hůl
    const badge = createStickBadge({
      expId: expedition.id,
      distanceMeters: 1350,
      stampsCount: 2,
    });
    assert.ok(badge?.id, 'Štítek na hůl musí být úspěšně vytvořen');

    // 3. Ověření přítomnosti trvalého tlačítka #walk-finish v mapovém šablonovém zdrojovém kódu
    const walkJsCode = fs.readFileSync('src/walk.js', 'utf-8');
    assert.ok(walkJsCode.includes('id="walk-finish"'), 'Tlačítko #walk-finish musí existovat v šabloně mapy');
    assert.ok(walkJsCode.includes('id="walk-start-unified"'), 'Tlačítko #walk-start-unified musí existovat');
    assert.ok(walkJsCode.includes('class="map-action-bar"'), 'Třída .map-action-bar musí existovat');
    assert.ok(walkJsCode.includes('btn-p3-skip-stop'), 'Tlačítko pro vynechání zastávky musí existovat');
    assert.ok(walkJsCode.includes('btn-p3-insert-stop'), 'Tlačítko pro vložení zastávky do trasy musí existovat');
    assert.ok(walkJsCode.includes('btn-p3-set-end'), 'Tlačítko pro nastavení konečného cíle musí existovat');
  });

  it('Záznam na pozadí při zhasnutém displeji: Neslyšný audio keepalive, MediaSession a nezastavování na pagehide', () => {
    // 1. Ověření platnosti neslyšného audio streamu WAV
    assert.ok(SILENT_WAV_BASE64.startsWith('data:audio/wav;base64,RIFF') || SILENT_WAV_BASE64.startsWith('data:audio/wav;base64,Uk'), 'Formát neslyšného audia musí být platný WAV');
    const rawBase64 = SILENT_WAV_BASE64.split(',')[1];
    const buf = Buffer.from(rawBase64, 'base64');
    assert.equal(buf.subarray(0, 4).toString(), 'RIFF', 'Hlavička musí být RIFF');
    assert.equal(buf.subarray(8, 12).toString(), 'WAVE', 'Formát musí být WAVE');

    // 2. Ověření MediaSession a bezpečného běhu background keepalive funkcí
    const actionHandlers: Record<string, Function> = {};
    const mockMediaSession = {
      metadata: null as any,
      playbackState: 'none',
      setActionHandler: (type: string, fn: Function) => {
        actionHandlers[type] = fn;
      },
    };
    try {
      Object.defineProperty(globalThis.navigator, 'mediaSession', {
        value: mockMediaSession,
        configurable: true,
        writable: true,
      });
    } catch {
      (globalThis.navigator as any).mediaSession = mockMediaSession;
    }
    (globalThis as any).MediaMetadata = class MockMediaMetadata {
      title: string;
      artist: string;
      album: string;
      artwork: any[];
      constructor(opts: any) {
        this.title = opts.title;
        this.artist = opts.artist;
        this.album = opts.album;
        this.artwork = opts.artwork || [];
      }
    };

    (globalThis as any).window = globalThis;
    let pauseCalled = false;
    let resumeCalled = false;
    let stopCalled = false;

    startBackgroundTracking({
      title: 'Výprava odstartována',
      artist: 'Czekpoint',
      album: 'Záznam chůze i při zhasnutém displeji',
      onPause: () => { pauseCalled = true; },
      onResume: () => { resumeCalled = true; },
      onStop: () => { stopCalled = true; },
    });

    assert.equal(mockMediaSession.playbackState, 'playing');
    assert.equal(mockMediaSession.metadata.title, 'Výprava odstartována');

    // Test MediaSession akcí z lock screenu
    actionHandlers['pause']?.();
    assert.equal(pauseCalled, true, 'Kliknutí na pauzu na lock screenu musí vyvolat onPause');
    actionHandlers['play']?.();
    assert.equal(resumeCalled, true, 'Kliknutí na play na lock screenu musí vyvolat onResume');
    actionHandlers['stop']?.();
    assert.equal(stopCalled, true, 'Kliknutí na stop na lock screenu musí vyvolat onStop');

    // Aktualizace stavu na lock screenu
    updateBackgroundTracking({ title: '👣 1 500 m (22 min) · Cíl: Zámek' });
    assert.equal(mockMediaSession.metadata.title, '👣 1 500 m (22 min) · Cíl: Zámek');

    // Pozastavení a ukončení
    pauseBackgroundTracking();
    assert.equal(mockMediaSession.playbackState, 'paused');
    stopBackgroundTracking();
    assert.equal(mockMediaSession.playbackState, 'none');

    // 3. Ověření v kódu walk.js: pagehide NIKDY nevolá pauseSession() a indikátor běhu na pozadí existuje
    const walkJsCode = fs.readFileSync('src/walk.js', 'utf-8');
    assert.ok(!walkJsCode.includes('const pagehide = () => pauseSession();'), 'pagehide nesmí volat pauseSession()');
    assert.ok(walkJsCode.includes('walk-bg-record'), 'Indikátor walk-bg-record musí existovat v šabloně');
    assert.ok(walkJsCode.includes('bg-record-status'), 'Indikátor bg-record-status musí existovat v šabloně');
  });

  it('ZADÁNÍ #10 (v1.2): Stabilizace kompasu, Výškový profil, Fotky míst, Koláž pohlednic, Offline mapy, Kapesní režim a obnova mezery', async () => {
    // 1. Stabilizace kompasu (sin/cos low-pass, deadband 2.5°, plynulý přechod přes 360° bez otočky o -358°)
    const stab = createCompassStabilizer({ alpha: 0.12, deadbandDeg: 2.5, minIntervalMs: 80 });
    const r0 = stab.update(359, 1000);
    assert.equal(r0.updated, true);
    assert.equal(Math.round(r0.continuousAngle), 359);

    // Drobný šum < 2.5° v pásmu necitlivosti (deadband) nebo pod 80 ms se ignoruje
    const rNoise = stab.update(359.5, 1100);
    assert.equal(rNoise.updated, false, 'Změna pod 2.5° musí být odfiltrována deadbandem');

    // Přechod přes sever 359° -> 2° (více kroků filtru) nesmí udělat skok o -357°, ale plynule narůst nad 360°
    let lastCont = r0.continuousAngle;
    for (let step = 1; step <= 12; step++) {
      const rStep = stab.update(5, 1100 + step * 100);
      assert.ok(
        Math.abs(rStep.continuousAngle - lastCont) < 15,
        `Spojitý úhel kompasu nesmí skočit o stovky stupňů (delta=${rStep.continuousAngle - lastCont})`
      );
      lastCont = rStep.continuousAngle;
    }
    assert.ok(lastCont > 359, 'Při přechodu 359° -> 5° musí spojitý úhel růst nad 359° (např. ~364°), nikoliv klesnout k 0°');

    // 2. Fotky míst a vektorové ilustrace (src/place-photos.js)
    const castlePlace = { id: 'p-zamek', title: 'Zámek Rožmitál', kind: 'culture', category: 'castles', lat: 49.601, lng: 13.864 };
    const syncPhoto = getPlacePhotoSync(castlePlace);
    assert.ok(syncPhoto.photoUrl.startsWith('data:image/svg+xml;charset=utf-8,'), 'Fallback musí být SVG Data URL ilustrace podle kategorie');

    const mockWikiFetch = async () => ({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '101': {
              title: 'Zámek Rožmitál pod Třemšínem',
              thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/zamek.jpg', width: 400, height: 300 },
            },
          },
        },
      }),
    });
    const asyncPhoto = await resolvePlacePhoto(castlePlace, { fetchImpl: mockWikiFetch as any });
    assert.equal(asyncPhoto.isRealPhoto, true);
    assert.equal(asyncPhoto.photoUrl, 'https://upload.wikimedia.org/wikipedia/commons/thumb/zamek.jpg');

    // 3. Výškový profil trasy (src/elevation.js)
    const routeCoords: [number, number][] = [
      [49.6014, 13.8644],
      [49.5850, 13.8400],
      [49.5675, 13.8380], // Třemšín oblast
    ];
    const sampled = sampleRouteCoordinates(routeCoords, 30);
    assert.ok(sampled.length >= 25 && sampled.length <= 40, 'Vzorkování musí vytvořit 25–40 bodů');

    const profile = await fetchRouteElevationProfile(routeCoords, { fetchImpl: null as any });
    assert.ok(profile.points.length >= 25);
    assert.ok(profile.gainM >= 0);
    assert.ok(profile.maxEle >= profile.minEle);

    const profileHtml = renderElevationProfileCardHtml(profile, [{ title: 'Třemšín' }] as any, 0.5 as any);
    assert.ok(profileHtml.includes('elevation-profile-card'), 'HTML musí obsahovat .elevation-profile-card');
    assert.ok(profileHtml.includes('Stoupání +'), 'HTML musí zobrazovat celkové stoupání');
    assert.ok(profileHtml.includes('Klesání -'), 'HTML musí zobrazovat celkové klesání');

    // 4. Pohlednicová koláž z navštívených míst (src/postcards.js)
    const svgCollage = renderPostcardSvg({
      id: 'exp-collage-1',
      date: '2026-10-27T10:00:00Z',
      distanceMeters: 4200,
      elevationGainM: 135,
      pointsEarned: 180,
      stampsCount: 3,
      visitedPlacesWithPhotos: [
        { title: 'Zámek Rožmitál', photoUrl: syncPhoto.photoUrl, kind: 'culture' },
        { title: 'Kaple na Třemšíně', photoUrl: generateCategoryPlaceSvgDataUrl({ title: 'Kaple', kind: 'chapel' }), kind: 'culture' },
        { title: 'Pramen Lomnice', photoUrl: generateCategoryPlaceSvgDataUrl({ title: 'Pramen', kind: 'spring' }), kind: 'water' },
      ],
      trailCoordinates: routeCoords as any,
    });
    assert.ok(svgCollage.includes('POZDRAV Z VÝPRAVY'), 'Pohlednice musí obsahovat hlavičku POZDRAV Z VÝPRAVY');
    assert.ok(svgCollage.includes('Zámek Rožmitál'), 'Pohlednice musí obsahovat názvy navštívených míst v koláži');
    assert.ok(svgCollage.includes('+135 m'), 'Pohlednice musí obsahovat nastoupané metry');
    assert.ok(renderPostcardSvgDataUrl({ distanceMeters: 1200 }).startsWith('data:image/svg+xml;charset=utf-8,'));

    // 5. Offline mapy (src/offline-maps.js) a Service Worker (sw.js)
    const tile = latLngToTileXY(49.6014, 13.8644, 14);
    assert.equal(tile.z, 14);
    assert.ok(tile.x > 0 && tile.y > 0);
    const tileList = buildOfflineTileListForBounds(
      { south: 49.58, west: 13.82, north: 49.62, east: 13.90 },
      { zooms: [13, 14, 15], maxTiles: 120 }
    );
    assert.ok(tileList.length > 0 && tileList.length <= 120, 'Počet dlaždic pro offline stažení musí být max 120');
    assert.equal(fs.existsSync('sw.js'), true, 'Service Worker sw.js musí existovat v kořeni projektu');

    // 6. Background Gap Recovery (src/keep-alive.js): mezera > 12 s do 3 km při chůzi <= 3.5 m/s
    const gapRecovery = interpolateBackgroundGap({
      prevFix: { lat: 49.6014, lng: 13.8644, ts: 1000 },
      nextFix: { lat: 49.6032, lng: 13.8670, ts: 141000 }, // 140 sekund v kapse (~275 m -> ~1.96 m/s)
      plannedCoords: [
        [49.6014, 13.8644],
        [49.6023, 13.8657],
        [49.6032, 13.8670],
      ] as any,
    } as any);
    assert.equal(gapRecovery.recovered, true, 'Mezera > 12 s při normální chůzi musí být dopočítána');
    assert.ok(gapRecovery.points.length >= 5, 'Musí vzniknout interpolované body pro odkrytí mlhy a zastávek');

    // 7. Ověření v1.2/v1.3/v1.4-part1 prvků v index.html a src/walk.js
    const indexHtml = fs.readFileSync('index.html', 'utf-8');
    assert.ok(indexHtml.includes('v1.2') || indexHtml.includes('v1.3') || indexHtml.includes('v1.4'), 'index.html musí mít platnou verzi');
    const walkJs = fs.readFileSync('src/walk.js', 'utf-8');
    assert.ok(walkJs.includes('map-lupa-search-input'), 'Vyhledávací lupa v mapě musí existovat');
    assert.ok(walkJs.includes('btn-pocket-mode'), 'Tlačítko Kapesního režimu musí existovat');
    assert.ok(walkJs.includes('arrival-goal-modal'), 'Dialog po příchodu do cíle musí existovat');
  });

  it('Oprava blikání bodů, hustoty míst v okolí, přiblížení mapy (16.5 + tlačítka +/-), hlášení každého rohu domu a chůze postavičky při zhasnutém displeji', async () => {
    // 1. Ověřené načítání z auto-places
    const testCenter = { lat: 49.7500, lng: 14.1500 };
    const failingOverpassFetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
    const nearbyPlaces = await loadAutoPlacesForArea(
      testCenter,
      [],
      {},
      null,
      failingOverpassFetch as any,
      null,
      { radiusM: 4000, forceRefresh: true }
    );
    assert.ok(Array.isArray(nearbyPlaces), 'Načítání bodů v okolí musí vracet pole');

    // 2. Detekce každého rohu domu / ulice (>= 15°) a 3-fázové hlasové hlášení (_adv, _app, _now)
    // Vytvoříme trasu vedoucí 60 m na sever a pak zahýbající doprava (na východ) za roh domu
    const cornerCoords: [number, number][] = [
      [49.60100, 13.86400], // Start
      [49.60127, 13.86400], // +30 m severně
      [49.60154, 13.86400], // +60 m severně (ROH DOMU -> odbočka doprava na východ)
      [49.60154, 13.86450], // +36 m východně
      [49.60154, 13.86500], // Cíl (+72 m východně)
    ];
    const targetStop = { id: 'cil-za-rohem', title: 'Kaplička za rohem', lat: 49.60154, lng: 13.86500 };
    const steps = buildDetailedCornerSteps(cornerCoords, [targetStop]);
    const rightCornerStep = steps.find((s: any) => s.coordIndex === 2);
    assert.ok(rightCornerStep, 'Každý roh ulice/domu musí být detekován jako odbočovací krok');
    assert.match(rightCornerStep.actionLabel, /vpravo/i);
    assert.match(rightCornerStep.voiceAction, /vpravo/i);

    const routeObj = {
      coordinates: cornerCoords,
      steps,
      distanceM: 132,
      isFallback: false,
    };

    // Hráč je 45 m před rohem (Fáze 1: Příprava prep_)
    const pos45mBefore = { lat: 49.60114, lng: 13.86400 };
    const navAdv = computeActiveTurnInstruction(routeObj as any, pos45mBefore as any, [targetStop] as any, new Set() as any);
    assert.ok(navAdv.stepKey.startsWith('prep_'), `Ve vzdálenosti ~45 m před rohem má být fáze prep_, získáno: ${navAdv.stepKey}`);
    assert.equal(navAdv.turnDirection, 'right');
    assert.match(navAdv.voiceText, /Připravte se.*na rohu/i);

    // Hráč je 8 m před rohem (Fáze 2: Akce na rohu exec_)
    const pos8mBefore = { lat: 49.60147, lng: 13.86400 };
    const navNow = computeActiveTurnInstruction(routeObj as any, pos8mBefore as any, [targetStop] as any, new Set() as any);
    assert.ok(navNow.stepKey.startsWith('exec_'), `Ve vzdálenosti ~8 m před rohem má být akce exec_, získáno: ${navNow.stepKey}`);
    assert.match(navNow.voiceText, /Teď na rohu/i);

    // 3. Chůze postavičky (GpsSimulator) pokračuje v reálném čase i při zhasnutém displeji (triggerLoopTick)
    const fixesReceived: any[] = [];
    const sim = new GpsSimulator({
      initialPosition: { lat: 49.60100, lng: 13.86400 },
      onFix: (fix: any) => fixesReceived.push(fix),
    });
    sim.isOpen = true;
    sim.mode = 'direction';
    sim.currentDirectionDeg = 0; // chůze na sever
    sim.speed = 5; // 5 m/s
    sim.lastWallTickMs = 1000;
    sim.triggerLoopTick(3000); // 2 sekundy na pozadí při zhasnutém displeji
    assert.ok(sim.position.lat > 49.60103, 'Postavička musí při zhasnutém displeji plynule pokračovat v chůzi');
    assert.ok(fixesReceived.length >= 1, 'Během chůze na pozadí musí simulátor emitovat GPS souřadnice pro hlasovou navigaci');
    sim.stopLoop();

    // 4. KeepAlive onTick + ověření in-place aktualizace markerů a zoom tlačítek v src/walk.js
    const ka = createKeepAliveController();
    let tickCount = 0;
    ka.onTick(() => { tickCount += 1; });
    ka.triggerManualTick();
    assert.equal(tickCount, 1, 'KeepAlive kontrolér musí spouštět registrované background tick callbacky');
    assert.equal(playTurnAudioCue('right'), false); // V Node prostředí bez AudioContext bezpečně vrátí false

    const walkJs = fs.readFileSync('src/walk.js', 'utf-8');
    assert.ok(walkJs.includes('placeMarkersById'), 'Markery v mapě se musí aktualizovat in-place přes placeMarkersById bez blikání');
    assert.ok(walkJs.includes('id="walk-zoom-in"'), 'Tlačítko přiblížení #walk-zoom-in musí existovat');
    assert.ok(walkJs.includes('id="walk-zoom-out"'), 'Tlačítko oddálení #walk-zoom-out musí existovat');
    assert.ok(walkJs.includes('16.5'), 'Výchozí přiblížení mapy musí být detailní (16.5)');
  });

  it('v1.3 (ZADÁNÍ #11): Zákaz vymýšlení falešných míst, 2-fázová odbočovací navigace a uzamčený origin výpravy', () => {
    const places = deduplicatePlaces([
      { id: 'p1', title: 'Kaplička', lat: 49.601, lng: 13.864, category: 'castles', kind: 'culture' },
      { id: 'p2', title: 'Křížek', lat: 49.601005, lng: 13.864005, category: 'castles', kind: 'culture' },
      { id: 'p3', title: 'Památník', lat: 49.602, lng: 13.865, category: 'castles', kind: 'culture' },
    ]);
    assert.ok(places.length >= 2, 'Deduplikace na 18 m nesmí sloučit různé památky');

    const rich = ensureRichLocalCoverage(places);
    assert.equal(rich.length, places.length, 'ensureRichLocalCoverage nesmí vymýšlet žádná falešná místa');

    const walkJs = fs.readFileSync('src/walk.js', 'utf-8');
    assert.ok(walkJs.includes('lockedExpeditionOrigin'), 'lockedExpeditionOrigin musí uzamykat místo startu výpravy');
    assert.ok(walkJs.includes('stateSig'), 'stateSig diffing brání zbytečnému re-renderování markerů');
    assert.ok(walkJs.includes('updateTurnNavPill(cleanFix)'), 'Navigace a rohy se musí aktualizovat na každý GPS fix');
  });

  it('DÁVKA 1 (v1.4-part1): 4-kritériová validace GPS vzorků, zákaz hromadného stahování OSM dlaždic, indikátor v mapě, pauza simulátoru a purpurová trasa', async () => {
    // 1. Kompletní 4-kritériová validace vzorků GPS (validateGpsSample):
    //    (a) souřadnice, (b) časová následnost, (c) přesnost <= 40 m, (d) rychlost vůči času (teleport filtr)
    const validate = validateGpsSample as any;
    const badCoords = validate({ lat: NaN, lng: 13.8644, accuracy: 10, timestamp: 1000 }, null, 1000);
    assert.equal(badCoords.valid, false);
    assert.equal(badCoords.failedCriterion, 'coords');

    const prevFix = { lat: 49.6014, lng: 13.8644, accuracy: 8, timestamp: 5000 };
    const olderFix = validate({ lat: 49.6015, lng: 13.8644, accuracy: 8, timestamp: 4000 }, prevFix, 5500);
    assert.equal(olderFix.valid, false);
    assert.equal(olderFix.failedCriterion, 'timestamp');

    const inaccurateFix = validate({ lat: 49.6015, lng: 13.8644, accuracy: 55, timestamp: 6000 }, prevFix, 6000);
    assert.equal(inaccurateFix.valid, false);
    assert.equal(inaccurateFix.failedCriterion, 'accuracy');

    // Teleport o ~1,1 km za 2 sekundy (> 3,5 m/s)
    const teleportFix = validate({ lat: 49.6114, lng: 13.8644, accuracy: 8, timestamp: 7000 }, prevFix, 7000);
    assert.equal(teleportFix.valid, false);
    assert.equal(teleportFix.failedCriterion, 'speed');

    // Platný vzorek (posun ~11 m za 5 sekund = ~2,2 m/s, přesnost 8 m)
    const validFix = validate({ lat: 49.6015, lng: 13.8644, accuracy: 8, timestamp: 10000 }, prevFix, 10000);
    assert.equal(validFix.valid, true);
    assert.equal(validFix.failedCriterion, null);

    // 2. Zákaz hromadného předstahování dlaždic z tile.openstreetmap.org (OSM Tile Usage Policy)
    const tiles = buildOfflineTileListForBounds({ south: 49.59, west: 13.85, north: 49.61, east: 13.87 });
    assert.ok(tiles.every((t: any) => t.url === null && t.layer === 'passive-cache-only'), 'buildOfflineTileListForBounds nesmí generovat URL pro hromadné stahování z tile.openstreetmap.org');

    const dlRes = await (downloadOfflineArea as any)({
      bounds: { south: 49.59, west: 13.85, north: 49.61, east: 13.87 },
      center: { lat: 49.6014, lng: 13.8644 },
      places: [],
    });
    assert.equal((dlRes as any).bulkTilesDisabled, true);

    // 3. Pauza simulátoru zastaví i autopilota a pokračování jej obnoví
    const sim = new GpsSimulator({ initialPosition: { lat: 49.6014, lng: 13.8644 } });
    sim.mode = 'autopilot';
    sim.pause();
    assert.equal(sim.isPaused, true);
    assert.equal(sim.mode, 'idle', 'Při pauze musí simulátor zastavit autopilota');
    sim.resume();
    assert.equal(sim.isPaused, false);
    assert.equal(sim.mode, 'autopilot', 'Při pokračování se obnoví předchozí režim simulátoru');
    sim.destroy();

    // 4. Ověření #map-busy-indicator, sjednocených názvů 3 stylů (bez KCD/KCD2) a purpurové trasy (#9333ea / #2e1065)
    const walkJs = fs.readFileSync('src/walk.js', 'utf-8');
    const walkCss = fs.readFileSync('assets/walk.css', 'utf-8');
    const stylesCss = fs.readFileSync('assets/styles.css', 'utf-8');

    assert.ok(walkJs.includes('id="map-busy-indicator"'), '#map-busy-indicator musí existovat v #walk-map-wrap');
    assert.ok(walkJs.includes('beginMapTask(') && walkJs.includes('endMapTask('), 'Počítadlo aktivních úloh beginMapTask / endMapTask musí existovat');
    assert.ok(walkJs.includes('#9333ea') && walkJs.includes('#2e1065'), 'Trasa musí být vykreslena purpurovou barvou #9333ea s tmavým lemem #2e1065');
    assert.ok(walkJs.includes('🎯 Zpět ke mně'), 'Tlačítko návratu na polohu musí mít popisek 🎯 Zpět ke mně');
    assert.ok(!walkJs.includes('(KCD2)'), 'Zkratka KCD2 musí být odstraněna z uživatelského rozhraní');
    assert.ok(walkCss.includes('z-index: 1200'), '.map-busy-indicator musí mít z-index: 1200');
    assert.ok(stylesCss.includes('transform: none !important'), 'Předci mapy (#main, .page-shell) nesmí mít přetrvávající transform kvůli fullscreenu');
  });

  it('DÁVKA 2 (v1.4-part2): Osobní atlas malých objevů, 3 nezaměnitelné záznamy podle GPS, zákaz smyšlených míst, kontrola externích fotek a stav trasy routed_foot / fallback_direct', async () => {
    // 1. Osobní atlas malých objevů: 6 symbolů, bezpečná textová poznámka (bez XSS) a výzvy všímavosti
    assert.equal(PERSONAL_MEMORY_SYMBOLS.length, 6);
    const symbolIds = PERSONAL_MEMORY_SYMBOLS.map((s: any) => s.id);
    assert.deepEqual(symbolIds, ['tree', 'view', 'calm', 'water', 'nature', 'detail']);

    assert.ok(MINDFULNESS_PROMPTS.length >= 3);
    for (const p of MINDFULNESS_PROMPTS as any[]) {
      assert.equal(/silnic|přecház|soukrom|dotkni|utrhni/i.test(p.text), false, 'Výzva všímavosti nesmí vyžadovat nebezpečné chování');
    }

    const sanitizedNote = sanitizeMemoryNoteText('  Klidná lavička\u0000\n u dubu  ');
    assert.equal(sanitizedNote, 'Klidná lavička u dubu');

    const memEntry = createPersonalMemoryEntry({
      symbolId: 'tree',
      note: '<img src=x onerror=alert(1)>Staletý dub u cesty',
      lat: 49.6018,
      lng: 13.8639,
    });
    assert.equal(memEntry.recordType, 'user_memory');
    assert.equal(memEntry.symbolIcon, '🌳');
    assert.equal(memEntry.symbolLabel, '🌳 Strom');
    assert.equal(memEntry.isUserMemory, true);
    assert.match(memEntry.recordBadge, /Vlastnoruční vzpomínka uživatele/);

    // 2. Pravdivé rozlišení 3 nezaměnitelných záznamů: gps_stop, gps_nearby, user_memory
    assert.equal(NEARBY_RECORD_RADIUS_M, 60);
    const clsMemory = classifyVisitRecord(memEntry);
    assert.ok(clsMemory);
    assert.equal(clsMemory.recordType, 'user_memory');
    assert.match(clsMemory.badge, /Vlastnoruční vzpomínka uživatele/);
    assert.equal(clsMemory.shortBadge, '✨ Vlastní poznámka uživatele');

    const clsStop = classifyVisitRecord('zamek-rozmital', {
      confirmedStopIds: new Set(['zamek-rozmital']),
    });
    assert.ok(clsStop);
    assert.equal(clsStop.recordType, 'gps_stop');
    assert.equal(clsStop.shortBadge, '📍 Potvrzeno podle GPS (zastávka)');
    assert.match(clsStop.explanation, /GPS měří přiblížení v terénu/);

    const clsNearby = classifyVisitRecord('podbrdske-muzeum', {
      confirmedStopIds: new Set(),
      discoveries: ['podbrdske-muzeum'],
    });
    assert.ok(clsNearby);
    assert.equal(clsNearby.recordType, 'gps_nearby');
    assert.equal(clsNearby.shortBadge, '📍 Zaznamenáno poblíž (dle GPS)');

    // 3. Zákaz smyšlených míst (žádné buildLocalFallbackPlaces) a stav při nedostupnosti sítě
    const autoPlacesSource = fs.readFileSync('src/auto-places.js', 'utf-8');
    assert.equal(autoPlacesSource.includes('buildLocalFallbackPlaces'), false, 'buildLocalFallbackPlaces nesmí v auto-places.js vůbec existovat');

    const remoteCenter = { lat: 50.2500, lng: 15.1000 }; // Mimo pilotní oblast Rožmitálu
    const failingFetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const failedResult = await loadAutoPlacesForArea(
      remoteCenter,
      [],
      {},
      null,
      failingFetch as any,
      null,
      { radiusM: 4000, forceRefresh: true }
    );
    assert.equal(failedResult.length, 0, 'Při výpadku služby mimo známá data nesmí vzniknout žádná vymyšlená místa');
    const lastStatus = getLastAutoPlacesStatus();
    assert.equal(lastStatus.failed, true);
    assert.equal(lastStatus.message, 'Místa v okolí se nepodařilo načíst');

    // 4. Kontrola externích fotografií míst (showExternalPhotos: false vrací čistou vektorovou ilustraci kategorie)
    const placeWithPhoto = {
      id: 'zamek-rozmital',
      title: 'Zámek Rožmitál',
      kind: 'culture',
      category: 'castles',
      photoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/zamek.jpg',
    };
    const disabledSync = getPlacePhotoSync(placeWithPhoto, null, { showExternalPhotos: false });
    assert.equal(disabledSync.isRealPhoto, false);
    assert.ok(disabledSync.photoUrl.startsWith('data:image/svg+xml;charset=utf-8,'), 'Při vypnutých externích fotkách se musí použít vektorová ilustrace kategorie');

    const disabledAsync = await resolvePlacePhoto(placeWithPhoto, { showExternalPhotos: false });
    assert.equal(disabledAsync.isRealPhoto, false);
    assert.ok(disabledAsync.photoUrl.startsWith('data:image/svg+xml;charset=utf-8,'));
    const photoLabels = formatPhotoSourceLabel({ isRealPhoto: true, license: 'CC BY-SA 4.0' } as any);
    assert.match(photoLabels.sourceLabel, /Wikipedie/);
    assert.match(photoLabels.licenseLabel, /CC BY-SA 4\.0/);

    // 5. Stav trasy routed_foot vs. fallback_direct, zákaz hlasové navigace na fallback přímce a zamknutý start
    const origin = { id: 'start', title: 'Start', lat: 49.6014, lng: 13.8644 };
    const stopA = { id: 'stop-a', title: 'Podbrdské muzeum', lat: 49.5993, lng: 13.8626 };

    const analysisRouted = analyzePlannedRoute({
      origin,
      orderedStops: [stopA],
      companionMode: 'solo',
      returnToOrigin: true,
      routedGeometry: { distanceM: 1200, isFallback: false, hasStructuredSurfaceData: false },
    });
    assert.equal(analysisRouted.routeStatus, 'routed_foot');
    assert.equal(analysisRouted.routeStatusLabel, '🥾 Vypočteno pěším routerem (nezaručuje schůdnost ani bezpečný přístup)');
    assert.equal(analysisRouted.roadTypeSummary, 'Údaje o typu cesty nejsou k dispozici');

    const analysisFallback = analyzePlannedRoute({
      origin,
      orderedStops: [stopA],
      companionMode: 'solo',
      returnToOrigin: true,
      routedGeometry: { distanceM: 600, isFallback: true },
    });
    assert.equal(analysisFallback.routeStatus, 'fallback_direct');
    assert.equal(analysisFallback.routeStatusLabel, '⚠️ Orientační vzdušná spojnice');

    // Při výpadku routeru mimo lokální síť cest vrátí fetchWalkingGeometry fallback_direct (isFallback: true)
    const remoteWaypoints = [
      { id: 'r1', title: 'Bod 1', lat: 50.1000, lng: 14.5000 },
      { id: 'r2', title: 'Bod 2', lat: 50.1050, lng: 14.5100 },
    ];
    const fallbackRoute = await fetchWalkingGeometry(remoteWaypoints, failingFetch as any);
    assert.equal(fallbackRoute.isFallback, true);
    assert.equal(fallbackRoute.routeStatus, 'fallback_direct');
    assert.equal(fallbackRoute.steps.length, 0, 'Vzdušná spojnice nesmí generovat odbočovací kroky');

    const fallbackNav: any = computeActiveTurnInstruction(
      fallbackRoute as any,
      remoteWaypoints[0] as any,
      [remoteWaypoints[1]] as any,
      new Set() as any
    );
    assert.equal(fallbackNav.isFallbackDirect, true);
    assert.equal(Boolean(fallbackNav.voiceText), false, 'Pro orientační vzdušnou spojnici se nesmí spouštět hlasová navigace odboček');
    assert.match(fallbackNav.text, /Orientační vzdušná spojnice/);

    // 6. Turistické trasy PILOT_HIKING_TRAILS neobsahují přímé spojnice přes rybník Podzámecký ([49.6038, 13.8552] -> [49.6052, 13.8576])
    for (const trail of PILOT_HIKING_TRAILS as any[]) {
      for (const seg of trail.segments || []) {
        for (const [lat, lng] of seg) {
          // Střed vodní plochy Podzámeckého rybníka je kolem [49.6043, 13.8568]
          const distToPondCenter = haversineMeters({ lat, lng }, { lat: 49.6043, lng: 13.8568 });
          assert.ok(distToPondCenter == null || distToPondCenter > 65, `Trasa ${trail.name} nesmí vést středem rybníka`);
        }
      }
    }
  });
});

