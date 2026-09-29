/* Size Guides Seed */

/**
 * The shipped size guides — what the site showed before anyone edited it, and
 * what "Reset to defaults" restores.
 *
 * A copy of the three documents, folded out of the client's `sizeCharts.json`:
 * each guide now carries its own `howTo` steps, and the international
 * conversions belong to the garment guide they were always read with. Once seeded,
 * this file is the authority — the JSON on the client is only an offline floor.
 *
 * Keyed by guide type. Shapes are checked by `versions/v1/schemas/sizeGuides.schema.js`,
 * so a typo here fails the seed script rather than reaching a shopper.
 */

export const SEED_SIZE_GUIDES =
  {
    "garment": {
      "note": "Belioras dresses are cut with a tailored silhouette. Between sizes, we suggest the larger.",
      "rows": [
        {
          "size": "XS",
          "bust": [
            80,
            84
          ],
          "waist": [
            62,
            66
          ],
          "hip": [
            88,
            92
          ]
        },
        {
          "size": "S",
          "bust": [
            84,
            88
          ],
          "waist": [
            66,
            70
          ],
          "hip": [
            92,
            96
          ]
        },
        {
          "size": "M",
          "bust": [
            88,
            94
          ],
          "waist": [
            70,
            76
          ],
          "hip": [
            96,
            102
          ]
        },
        {
          "size": "L",
          "bust": [
            94,
            100
          ],
          "waist": [
            76,
            82
          ],
          "hip": [
            102,
            108
          ]
        },
        {
          "size": "XL",
          "bust": [
            100,
            106
          ],
          "waist": [
            82,
            88
          ],
          "hip": [
            108,
            114
          ]
        },
        {
          "size": "XXL",
          "bust": [
            106,
            112
          ],
          "waist": [
            88,
            94
          ],
          "hip": [
            114,
            120
          ]
        }
      ],
      "international": {
        "columns": [
          "US",
          "UK",
          "EU",
          "AUS",
          "Türkiye"
        ],
        "rows": [
          {
            "size": "XS",
            "us": "0–2",
            "uk": "4–6",
            "eu": "32–34",
            "aus": "4–6",
            "tr": "32–34"
          },
          {
            "size": "S",
            "us": "2–4",
            "uk": "6–8",
            "eu": "34–36",
            "aus": "6–8",
            "tr": "34–36"
          },
          {
            "size": "M",
            "us": "6",
            "uk": "10",
            "eu": "38",
            "aus": "10",
            "tr": "38"
          },
          {
            "size": "L",
            "us": "8–10",
            "uk": "12–14",
            "eu": "40–42",
            "aus": "12–14",
            "tr": "40–42"
          },
          {
            "size": "XL",
            "us": "12",
            "uk": "16",
            "eu": "44",
            "aus": "16",
            "tr": "44"
          },
          {
            "size": "XXL",
            "us": "14",
            "uk": "18",
            "eu": "46",
            "aus": "18",
            "tr": "46"
          }
        ]
      },
      "howTo": [
        {
          "term": "Bust",
          "text": "Place the tape close under the armhole and measure around the fullest part, keeping it level across the back."
        },
        {
          "term": "Waist",
          "text": "The narrowest part of the torso, usually just above the navel. Keep the tape snug, not tight."
        },
        {
          "term": "Hip",
          "text": "Roughly 20 cm below the natural waist, around the fullest part, with your feet together."
        },
        {
          "term": "Inside leg",
          "text": "From the top of the inner thigh straight down to the ankle bone."
        }
      ],
      "garmentImage": "https://ik.imagekit.io/sbgenu6wj/Belioras/image.png"
    },
    "footwear": {
      "note": "Our shoes are made on European lasts and run true to size. Between sizes, we suggest the larger.",
      "rows": [
        {
          "eu": 36,
          "uk": 3,
          "us": 5,
          "cm": 22.5
        },
        {
          "eu": 37,
          "uk": 4,
          "us": 6,
          "cm": 23.5
        },
        {
          "eu": 38,
          "uk": 5,
          "us": 7,
          "cm": 24.1
        },
        {
          "eu": 39,
          "uk": 6,
          "us": 8,
          "cm": 25.1
        },
        {
          "eu": 40,
          "uk": 6.5,
          "us": 9,
          "cm": 25.9
        },
        {
          "eu": 41,
          "uk": 7.5,
          "us": 10,
          "cm": 26.7
        }
      ],
      "howTo": [
        {
          "term": "Foot length",
          "text": "Stand on a sheet of paper, mark the heel and the longest toe, and measure between the marks."
        },
        {
          "term": "Time of day",
          "text": "Measure in the evening. Feet swell through the day, and a shoe fitted at breakfast can bind by dinner."
        },
        {
          "term": "Both feet",
          "text": "Measure both and take the larger. Most people have one foot slightly bigger."
        }
      ]
    },
    "hair": {
      "note": "Measured on a 168 cm frame. Inches are the trade standard; centimetres shown for EU customers.",
      "lengths": [
        {
          "in": 12,
          "falls": "Collarbone",
          "note": "A sharp bob. Holds the most volume."
        },
        {
          "in": 14,
          "falls": "Shoulder",
          "note": "Grazes the shoulder when straight."
        },
        {
          "in": 16,
          "falls": "Below shoulder",
          "note": "The most requested length."
        },
        {
          "in": 18,
          "falls": "Armpit",
          "note": "Long enough to gather."
        },
        {
          "in": 20,
          "falls": "Mid-back",
          "note": ""
        },
        {
          "in": 22,
          "falls": "Below mid-back",
          "note": ""
        },
        {
          "in": 24,
          "falls": "Waist",
          "note": ""
        },
        {
          "in": 26,
          "falls": "Below waist",
          "note": "Heaviest to wear all day."
        }
      ],
      "textures": [
        {
          "name": "Straight",
          "note": "Measures as stated. Nothing lost to curl pattern."
        },
        {
          "name": "Yaky",
          "note": "Sits close to straight; a relaxed texture with a soft finish."
        },
        {
          "name": "Wavy",
          "note": "Wears roughly one to two inches shorter than measured."
        },
        {
          "name": "Bouncy",
          "note": "Wears about two inches shorter; blow-dried body."
        },
        {
          "name": "Curly",
          "note": "Wears three to four inches shorter. Size up if length matters."
        },
        {
          "name": "Kinky",
          "note": "Wears four or more inches shorter — the tightest pattern we carry."
        },
        {
          "name": "Braided",
          "note": "Measured finished, so what is stated is what you wear."
        },
        {
          "name": "Locs",
          "note": "Measured finished. Weight builds with length."
        },
        {
          "name": "Short",
          "note": "Under 12 inches, cut to shape."
        }
      ],
      "howTo": [
        {
          "term": "Length",
          "text": "Measured straight, from the top of the weft to the tip, before any curl pattern is accounted for."
        },
        {
          "term": "Texture",
          "text": "Curlier patterns wear shorter than they measure. Check the texture table before choosing."
        },
        {
          "term": "Where it falls",
          "text": "The fall column is measured on a 168 cm frame. Taller or shorter changes where a length lands."
        }
      ]
    }
  };
