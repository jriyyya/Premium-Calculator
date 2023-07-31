import axios from "axios";

const WEATHER_API_KEY = "INSERT_HERE";

interface Land {
  location: {
    latitude: number;
    longitude: number;
  };
  area: number;
  crop: {
    id: number;
    name: string;
  };
  insuredFrom: number;
  insuredTo: number;
}

interface Condition {
  crop: string;
  maxtemp_c: number;
  maxtemp_f: number;
  mintemp_c: number;
  mintemp_f: number;
  avgtemp_c: number;
  avgtemp_f: number;
  maxwind_mph: number;
  maxwind_kph: number;
  totalprecip_mm: number;
  totalprecip_in: number;
  totalsnow_cm: number;
  avgvis_km: number;
  avgvis_miles: number;
  avghumidity: number;
  daily_will_it_rain: number;
  daily_chance_of_rain: number;
  daily_will_it_snow: number;
  daily_chance_of_snow: number;
  uv: number;
}

const land: Land = {
  location: {
    latitude: 33.2778,
    longitude: 75.34125,
  },
  area: 100,
  crop: {
    id: 1,
    name: "ragi",
  },
  insuredFrom: Date.now() - 3 * 24 * 60 * 60 * 1000,
  insuredTo: Date.now() + 3 * 24 * 60 * 60 * 1000,
};

function generateSlidingWindowArray(
  till: number,
  size: number,
  from: number = 0
) {
  const arr: number[][] = [];
  for (let i = 0; i <= till - size + 1; i++) {
    const arrX: number[] = [];
    for (let j = i; j < i + size; j++) {
      arrX.push(j);
    }
    arr.push(arrX);
  }

  return arr;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateDatesBetween(
  startTimestamp: number,
  endTimestamp: number
): string[] {
  const dates: string[] = [];

  const startDate = new Date(startTimestamp); // Convert to milliseconds
  const endDate = new Date(endTimestamp); // Convert to milliseconds

  // Loop through each day
  for (
    let date = startDate;
    date <= endDate;
    date.setDate(date.getDate() + 1)
  ) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");

    const formattedDate = `${year}-${month}-${day}`;
    dates.push(formattedDate);
  }

  return dates;
}

function filterPastDates(dates: string[]): string[] {
  const currentDate = new Date(); // Get the current date

  // Filter out past dates
  const filteredDates = dates.filter((date) => {
    const [year, month, day] = date.split("-").map(Number);
    const dateToCompare = new Date(year, month - 1, day); // Months are 0-based in JavaScript

    return dateToCompare < currentDate;
  });

  return filteredDates;
}

function calculateAverageNumberProperties(
  objects: { [key: string]: number }[]
): { [key: string]: number } {
  const propertySums: { [key: string]: number } = {};
  const propertyCounts: { [key: string]: number } = {};

  objects.forEach((obj) => {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === "number") {
        if (!propertySums[key]) {
          propertySums[key] = 0;
          propertyCounts[key] = 0;
        }
        propertySums[key] += value;
        propertyCounts[key]++;
      }
    });
  });

  const averages: { [key: string]: number } = {};

  for (const key in propertySums) {
    if (propertySums.hasOwnProperty(key)) {
      averages[key] = propertySums[key] / propertyCounts[key];
    }
  }

  return averages;
}

function findMaxValues(objects: { [key: string]: number }[]): {
  [key: string]: number;
} {
  const maxValues: { [key: string]: number } = {};

  objects.forEach((obj) => {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === "number") {
        if (!maxValues[key] || value > maxValues[key]) {
          maxValues[key] = value;
        }
      }
    });
  });

  return maxValues;
}

function linearMap(
  value: number,
  mapFrom: { from: number; to: number },
  mapTo: { from: number; to: number },
  clamp = true
) {
  const slope = (mapTo.to - mapTo.from) / (mapFrom.to - mapFrom.from);
  const ans = slope * (value - mapFrom.from) + mapTo.from;
  return clamp ? clampValue(ans, { min: mapTo.from, max: mapTo.from }) : ans;
}

async function isClaimValid(land: Land, _options?: { checkIntervals: number }) {
  const options = { ..._options };
  options.checkIntervals = options.checkIntervals || 5;

  const geolocation = (
    await axios.get(
      `https://geocode.maps.co/reverse?lat=${land.location.latitude}&lon=${land.location.longitude}`
    )
  ).data;

  const location =
    geolocation.address.state ||
    geolocation.address.state_district ||
    geolocation.address.country;

  const dates = filterPastDates(
    generateDatesBetween(land.insuredFrom, land.insuredTo)
  );

  const weatherData: Condition[] = [];

  for (const date of dates) {
    await sleep(100);
    const data = (
      await axios.get(
        `https://api.weatherapi.com/v1/history.json?key=${WEATHER_API_KEY}&q=${location}&dt=${date}`
      )
    ).data;
    data.forecast.forecastday.forEach((element: any) => {
      weatherData.push(element.hour);
    });
  }

  const ideal = (
    await axios.get<Condition[]>("https://api.npoint.io/8fb36c3096dbc24926a7")
  ).data;

  const cropBest = ideal.filter(
    (item) =>
      item.crop.toLowerCase().replace(/ /g, "") ===
      land.crop.name.toLowerCase().replace(/ /g, "")
  )[0];

  const windowSlides = generateSlidingWindowArray(
    weatherData.length - 1,
    Math.min(options.checkIntervals, Math.min(1, weatherData.length - 3))
  );

  let worstCondition: Condition = {} as Condition;

  for (const window of windowSlides) {
    const avgToArr: Condition[] = [];

    for (const i of window) {
      avgToArr.push(weatherData[i]);
    }

    let arrY: any[] = [];

    for (const i of avgToArr) {
      arrY.push(calculateAverageNumberProperties(i as any));
    }

    const diffArr: Condition[] = [];

    for (const d of arrY) {
      diffArr.push(prefixKeysWithAvg(d as any) as any, cropBest); //(calculateAbsoluteDifferenceObject(d, cropBest) as Condition);
    }

    worstCondition = findMaxValues(diffArr as any) as any;
  }

  let prob = 0;

  prob += clampValue(
    linearMap(
      worstCondition.avghumidity,
      { from: 0, to: 100 },
      { from: 0, to: 15 }
    ),
    {}
  );
  prob += clampValue(
    linearMap(
      worstCondition.avgtemp_c,
      { from: 0, to: 50 },
      { from: 0, to: 10 }
    ),
    { max: 10 }
  );
  prob += clampValue(
    linearMap(
      worstCondition.maxtemp_c,
      { from: 0, to: 50 },
      { from: 0, to: 15 }
    ),
    { max: 15 }
  );
  prob += clampValue(
    linearMap(
      worstCondition.daily_chance_of_rain,
      { from: 30, to: 100 },
      { from: 0, to: 10 }
    ),
    { max: 10 }
  );
  prob += clampValue(
    linearMap(
      worstCondition.maxwind_kph,
      { from: 0, to: 30 },
      { from: 0, to: 15 }
    ),
    { max: 15 }
  );
  prob += clampValue(
    linearMap(
      worstCondition.totalsnow_cm,
      { from: 0, to: 50 },
      { from: 0, to: 15 }
    ),
    { max: 15 }
  );
  prob += clampValue(
    linearMap(
      worstCondition.totalprecip_in,
      { from: 0, to: 30 },
      { from: 0, to: 15 }
    ),
    { max: 15 }
  );

  return clampValue(
    linearMap(prob, { from: 0, to: 90 }, { from: 0, to: 100 }),
    { min: 0, max: 99 }
  );
}

function prefixKeysWithAvg(obj: { [key: string]: any }): {
  [key: string]: any;
} {
  const newObj: { [key: string]: any } = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const newKey = "avg" + key;
      newObj[newKey] = obj[key];
    }
  }

  return newObj;
}

function calculateAverageObject(
  objects: object[]
): { [key: string]: number } | null {
  if (objects.length === 0) {
    return null;
  }

  const keys = Object.keys(objects[0]);
  const result: { [key: string]: number } = {};

  for (const key of keys) {
    const values = objects
      .map((obj) => (obj as any[])[key as any])
      .filter((value) => typeof value === "number");

    if (values.length > 0) {
      const sum = values.reduce((acc, value) => acc + value, 0);
      result[key] = sum / values.length;
    }
  }

  return result;
}

function calculateAbsoluteDifferenceObject(obj1: object, obj2: object): object {
  const result: object = {};

  for (let key in obj1) {
    if (
      typeof (obj1 as any)[key as any] === "number" &&
      typeof (obj2 as any)[key as any] === "number"
    ) {
      (result as any)[key as any] = Math.abs(
        (obj1 as any)[key as any] - (obj2 as any)[key as any]
      );
    }
  }

  return result;
}

function clampValue(value: number, options: { min?: number; max?: number }) {
  let ans = value;

  if (options.min && ans < options.min) {
    ans = options.min;
  }
  if (options.max && ans > options.max) {
    ans = options.max;
  }

  return ans;
}

async function main() {
  const prob = await isClaimValid(land, { checkIntervals: 5 });
  console.log(
    `probability that the claim is valid is ${prob}% and the claim can be considered as ${
      prob > 70 ? "" : "not"
    } valid`
  );
}

try {
  main();
} catch (err) {}
