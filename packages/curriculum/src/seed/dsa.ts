import type { SeedTechnologyInput } from './types.js';

/**
 * Data structures and algorithms — the one technology every user gets.
 *
 * Hand-written rather than generated, for two reasons. The obvious one is
 * cost: DSA is on every user's plan every day, so it would be the first
 * thing generated and the thing regenerated most. The better one is that
 * DSA is the most stable curriculum in the product. Two-pointer technique
 * has not changed since it was named, and paying a model to rediscover it
 * each time is spending money to introduce variance.
 *
 * Ordered by what the next one needs, not by interview frequency. Hashing
 * comes before two pointers because half the two-pointer problems degrade
 * to a hash lookup; graphs come after queues and recursion because BFS is
 * a queue and DFS is recursion, and teaching them together teaches neither.
 *
 * Exercises here are drills with real tests. Every `referenceSolution` is
 * executed by `reference-solutions.test.ts`, so a broken one fails the
 * build rather than the user.
 */
export const dsaCurriculum: SeedTechnologyInput = {
  slug: 'dsa',
  name: 'DSA',
  description:
    'Data structures and algorithms. Practised daily rather than studied in a block — ' +
    'the recall is the point, and recall does not survive being crammed.',
  category: 'foundations',
  exerciseLanguage: 'javascript',
  dependsOn: [],
  // First. It runs alongside everything else rather than waiting its turn,
  // and being first means it is never the thing that is still queued.
  learningOrder: 0,

  concepts: [
    // ---------------------------------------------------------------- 1
    {
      slug: 'complexity-analysis',
      name: 'Complexity analysis',
      description:
        'Reading the cost of code in time and space, and saying it in the notation ' +
        'an interviewer expects.',
      difficulty: 2,
      learningObjectives: [
        'State the time and space complexity of a loop, a nested loop, and a recursive call',
        'Recognise that dropping constants is deliberate, not sloppy',
        'Tell worst case from average case, and say which one you are quoting',
      ],
      codingPatterns: [
        'Count the work inside the loop, then multiply by the number of iterations',
        'Recursion: cost per call times number of calls, plus the depth of the stack',
      ],
      commonMistakes: [
        'Calling a two-pass loop O(n²) because there are two loops — sequential loops add, nested loops multiply',
        'Forgetting that building a result array of size n is O(n) space',
        'Quoting average case for a hash map without mentioning the worst case',
      ],
      questions: [
        {
          prompt:
            'A function loops over an array of length n, and then loops over it again separately. What is its time complexity?',
          options: ['O(n²)', 'O(2n), which simplifies to O(n)', 'O(n log n)', 'O(1)'],
          correctIndex: 1,
          explanation:
            'Sequential loops add, they do not multiply. n + n = 2n, and constant factors are dropped, so it is O(n). Nesting one loop inside the other would give O(n²).',
          difficulty: 1,
        },
        {
          prompt:
            'Why does Big-O drop constant factors, when an algorithm taking 100n steps is genuinely slower than one taking n?',
          options: [
            'Because constants are usually too hard to measure',
            'Because it describes how cost grows with input size, not how long one run takes',
            'Because modern hardware makes constants irrelevant',
            'Because the constant is always close to 1 in practice',
          ],
          correctIndex: 1,
          explanation:
            'Big-O answers "what happens when n doubles". Both 100n and n double. It is deliberately silent about which is faster today — that is what benchmarks are for, and the two questions get confused constantly.',
          difficulty: 2,
        },
        {
          prompt:
            'What is the space complexity of a recursive function that calls itself once per element of an n-element list, with no other allocation?',
          options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'],
          correctIndex: 2,
          explanation:
            'Each pending call holds a stack frame, and there are n of them before the first returns. The stack is space even though you never wrote an array — this is the allocation people forget in interviews.',
          difficulty: 2,
        },
      ],
      exercises: [
        {
          slug: 'dsa-count-pairs-naive-vs-linear',
          title: 'Count pairs summing to a target',
          kind: 'CODING',
          difficulty: 2,
          objective:
            'Write `countPairs(numbers, target)` returning how many unordered index pairs (i < j) have numbers[i] + numbers[j] === target. Your solution must run in O(n) time — a nested loop will time out on the hidden large case.',
          requirements:
            'Return a count, not the pairs themselves. Each pair is counted once. Duplicate values form valid pairs.',
          functionSignature: 'function countPairs(numbers, target) { }',
          examples: [
            'countPairs([1, 2, 3, 4], 5) // 2  — (1,4) and (2,3)',
            'countPairs([3, 3, 3], 6) // 3  — every pair of the three 3s',
          ],
          staticHints: [
            'What have you already seen by the time you reach index j?',
            'For each number, what single other number would complete the pair?',
            'Does the count of how many times you saw that number matter?',
          ],
          estimatedMinutes: 15,
          testCases: [
            {
              name: 'counts the two obvious pairs',
              code: 'if (solution([1,2,3,4], 5) !== 2) throw new Error("expected 2");',
            },
            {
              name: 'counts every pair among duplicates',
              code: 'if (solution([3,3,3], 6) !== 3) throw new Error("expected 3");',
            },
            {
              name: 'returns 0 when nothing pairs',
              code: 'if (solution([1,2,3], 100) !== 0) throw new Error("expected 0");',
            },
            {
              name: 'handles an empty array',
              code: 'if (solution([], 5) !== 0) throw new Error("expected 0");',
            },
            {
              name: 'is linear, not quadratic',
              hidden: true,
              code: [
                'const big = new Array(60000).fill(1);',
                'const started = Date.now();',
                'const result = solution(big, 2);',
                'if (Date.now() - started > 2000) throw new Error("too slow — this is O(n^2)");',
                'if (result !== (60000 * 59999) / 2) throw new Error("wrong count on the large case");',
              ].join('\n'),
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 2
    {
      slug: 'arrays-and-strings',
      name: 'Arrays and strings',
      description:
        'In-place work on contiguous data: traversal, reversal, rotation, and the ' +
        'index arithmetic that goes wrong every time.',
      difficulty: 2,
      prerequisites: [{ slug: 'complexity-analysis', strength: 'SOFT' }],
      learningObjectives: [
        'Mutate an array in place without allocating a second one',
        'Get the boundaries right on a two-index walk',
        'Know when a string must be copied because it is immutable',
      ],
      codingPatterns: [
        'Walk from both ends towards the middle, swapping',
        'Write index separate from read index for in-place filtering',
      ],
      commonMistakes: [
        'Off-by-one on the loop bound, so the middle element is swapped with itself or missed',
        'Mutating an array while iterating it and skipping elements',
        'Treating a JavaScript string as mutable — every "change" allocates a new one',
      ],
      questions: [
        {
          prompt:
            'You reverse an array in place by swapping arr[i] with arr[n-1-i]. What should the loop bound on i be?',
          options: ['i < n', 'i < n - 1', 'i < Math.floor(n / 2)', 'i <= n / 2'],
          correctIndex: 2,
          explanation:
            'Past the midpoint you swap every pair a second time, undoing the reversal. Stopping at floor(n/2) is correct for both odd and even n — with odd n the middle element needs no swap.',
          difficulty: 2,
        },
        {
          prompt:
            'Why is building a string by `result += char` inside a loop over n characters potentially O(n²)?',
          options: [
            'Because += is slower than array push',
            'Because strings are immutable, so each += may copy the whole string built so far',
            'Because the garbage collector runs on every iteration',
            'It is not — string concatenation is always O(1)',
          ],
          correctIndex: 1,
          explanation:
            'Each concatenation can allocate a new string and copy everything accumulated, giving 1 + 2 + ... + n work. Collecting into an array and joining once at the end is the standard fix. Engines optimise some cases, which is exactly why this surprises people when it bites.',
          difficulty: 3,
        },
      ],
      exercises: [
        {
          slug: 'dsa-move-zeroes',
          title: 'Move zeroes to the end',
          kind: 'CODING',
          difficulty: 2,
          objective:
            'Write `moveZeroes(numbers)` that moves every 0 to the end of the array **in place**, keeping the relative order of the non-zero values. Return the same array you were given. Do not allocate a second array.',
          requirements:
            'Mutate and return the input array. Relative order of non-zero elements must be preserved.',
          functionSignature: 'function moveZeroes(numbers) { }',
          examples: [
            'moveZeroes([0, 1, 0, 3, 12]) // [1, 3, 12, 0, 0]',
            'moveZeroes([0, 0]) // [0, 0]',
          ],
          staticHints: [
            'If you had a second array, where would each non-zero value go? Can that position be tracked with one number?',
            'What is true about everything before the write index once the walk finishes?',
            'What has to happen to the rest of the array after the last non-zero is written?',
          ],
          estimatedMinutes: 15,
          testCases: [
            {
              name: 'moves zeroes and keeps order',
              code: 'const r = solution([0,1,0,3,12]); if (JSON.stringify(r) !== JSON.stringify([1,3,12,0,0])) throw new Error("got " + JSON.stringify(r));',
            },
            {
              name: 'handles all zeroes',
              code: 'const r = solution([0,0]); if (JSON.stringify(r) !== JSON.stringify([0,0])) throw new Error("got " + JSON.stringify(r));',
            },
            {
              name: 'handles no zeroes',
              code: 'const r = solution([1,2,3]); if (JSON.stringify(r) !== JSON.stringify([1,2,3])) throw new Error("got " + JSON.stringify(r));',
            },
            {
              name: 'mutates in place rather than returning a copy',
              hidden: true,
              code: 'const input = [0,5,0,7]; const out = solution(input); if (out !== input) throw new Error("must return the same array instance"); if (JSON.stringify(input) !== JSON.stringify([5,7,0,0])) throw new Error("input was not mutated correctly");',
            },
            {
              name: 'handles an empty array',
              code: 'const r = solution([]); if (JSON.stringify(r) !== "[]") throw new Error("got " + JSON.stringify(r));',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 3
    {
      slug: 'hashing',
      name: 'Hash maps and sets',
      description:
        'Trading space for time. The single most common way an O(n²) solution ' +
        'becomes an O(n) one.',
      difficulty: 2,
      prerequisites: [{ slug: 'arrays-and-strings', strength: 'SOFT' }],
      learningObjectives: [
        'Recognise the "have I seen this before" shape and reach for a Set',
        'Use a Map to count occurrences in one pass',
        'Say why lookup is O(1) on average and O(n) in the worst case',
      ],
      codingPatterns: [
        'Seen-set: iterate once, check membership, then insert',
        'Frequency map: value to count, then a second pass over the map',
        'Complement lookup: for target - current, ask what you already hold',
      ],
      commonMistakes: [
        'Using an object as a map and colliding with inherited keys like "constructor"',
        'Inserting the current element before checking for its complement, so it pairs with itself',
        'Claiming O(1) worst case for hash lookup in an interview',
      ],
      questions: [
        {
          prompt:
            'In a two-sum solution using a Map, why must you check for the complement *before* inserting the current number?',
          options: [
            'Insertion is slower than lookup, so order matters for performance',
            'Otherwise an element can be matched with itself when target is twice its value',
            'The Map would grow too large',
            'It makes no difference to correctness',
          ],
          correctIndex: 1,
          explanation:
            'With target 6 and the value 3, inserting first means the lookup for the complement 3 finds the element you just added. You would report a pair made of one element used twice.',
          difficulty: 3,
        },
        {
          prompt:
            'Why is `new Map()` generally preferred over a plain object for a frequency count?',
          options: [
            'Maps use less memory',
            'Map keys are not coerced to strings and cannot collide with inherited properties',
            'Objects cannot store numbers as values',
            'Maps are always faster',
          ],
          correctIndex: 1,
          explanation:
            'An object coerces keys to strings, so 1 and "1" collide, and a key like "constructor" hits the prototype chain. A Map keeps key identity and has no prototype keys.',
          difficulty: 2,
        },
        {
          prompt: 'What is the worst-case time for a single hash map lookup?',
          options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
          correctIndex: 2,
          explanation:
            'If every key hashes to the same bucket the structure degenerates to a list. Average O(1) is the number worth quoting, but an interviewer asking for worst case wants O(n) and the reason.',
          difficulty: 2,
        },
      ],
      exercises: [
        {
          slug: 'dsa-first-unique-char',
          title: 'First non-repeating character',
          kind: 'CODING',
          difficulty: 2,
          objective:
            'Write `firstUniqueChar(text)` returning the index of the first character that appears exactly once in the string, or -1 if every character repeats. Solve it in O(n) time.',
          requirements:
            'Return an index, not the character. Compare characters exactly — case matters.',
          functionSignature: 'function firstUniqueChar(text) { }',
          examples: [
            'firstUniqueChar("leetcode") // 0',
            'firstUniqueChar("loveleetcode") // 2',
            'firstUniqueChar("aabb") // -1',
          ],
          staticHints: [
            'You need to know a character repeats before you reach the end. What does that force you to do first?',
            'Two passes over the string is still O(n). Does that help?',
            'Which pass tells you the *first* such index — the one over the string, or the one over the counts?',
          ],
          estimatedMinutes: 15,
          testCases: [
            {
              name: 'finds a unique first character',
              code: 'if (solution("leetcode") !== 0) throw new Error("expected 0");',
            },
            {
              name: 'skips repeated characters',
              code: 'if (solution("loveleetcode") !== 2) throw new Error("expected 2");',
            },
            {
              name: 'returns -1 when everything repeats',
              code: 'if (solution("aabb") !== -1) throw new Error("expected -1");',
            },
            {
              name: 'handles an empty string',
              code: 'if (solution("") !== -1) throw new Error("expected -1");',
            },
            {
              name: 'treats case as significant',
              hidden: true,
              code: 'if (solution("aA") !== 0) throw new Error("a and A are different characters");',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 4
    {
      slug: 'two-pointers',
      name: 'Two pointers',
      description:
        'Two indices moving under a rule that guarantees progress. Turns many ' +
        'nested loops into a single pass over sorted data.',
      difficulty: 3,
      prerequisites: [{ slug: 'hashing', strength: 'SOFT' }],
      learningObjectives: [
        'Decide which pointer to move from the comparison, not by alternating',
        'Recognise that the technique usually needs sorted input',
        'Prove the loop terminates because the gap strictly shrinks',
      ],
      codingPatterns: [
        'Converging: left at 0, right at n-1, move the one that can improve the result',
        'Fast and slow: one index advances by one, the other by two',
      ],
      commonMistakes: [
        'Moving both pointers every iteration and stepping over the answer',
        'Applying it to unsorted data where the comparison tells you nothing',
        'Using `left < right` where `left <= right` is needed, or the reverse',
      ],
      questions: [
        {
          prompt:
            'On a sorted array with left and right pointers, the sum is smaller than the target. Which pointer moves?',
          options: [
            'right moves left, to reduce the sum',
            'left moves right, to increase the sum',
            'Both move inward',
            'Either — it does not matter',
          ],
          correctIndex: 1,
          explanation:
            'The sum is too small, so it must increase. In sorted order the only way to increase it is a larger left value. Moving right would shrink the sum further and skip the answer.',
          difficulty: 2,
        },
        {
          prompt: 'Why does the converging two-pointer loop always terminate?',
          options: [
            'Because the array is finite',
            'Because every iteration moves exactly one pointer inward, so the gap strictly decreases',
            'Because a counter limits the iterations',
            'Because the values are sorted',
          ],
          correctIndex: 1,
          explanation:
            'Finiteness alone does not prevent an infinite loop — an iteration that moves nothing would spin forever. The guarantee is that the gap shrinks by at least one each time, so the loop runs at most n times.',
          difficulty: 3,
        },
      ],
      exercises: [
        {
          slug: 'dsa-is-palindrome-alnum',
          title: 'Valid palindrome, ignoring punctuation',
          kind: 'CODING',
          difficulty: 3,
          objective:
            'Write `isPalindrome(text)` returning true if the string reads the same forwards and backwards, considering only letters and digits and ignoring case. Use O(1) extra space — do not build a cleaned copy of the string.',
          requirements:
            'Ignore every character that is not a letter or digit. Compare case-insensitively. An empty string is a palindrome.',
          functionSignature: 'function isPalindrome(text) { }',
          examples: [
            'isPalindrome("A man, a plan, a canal: Panama") // true',
            'isPalindrome("race a car") // false',
            'isPalindrome(" ") // true',
          ],
          staticHints: [
            'The O(1) space rule rules out cleaning the string first. What has to happen instead, during the walk?',
            'What should a pointer do when it lands on a character that should be ignored?',
            'Which comparison makes case irrelevant without allocating?',
          ],
          estimatedMinutes: 18,
          testCases: [
            {
              name: 'accepts a punctuated palindrome',
              code: 'if (solution("A man, a plan, a canal: Panama") !== true) throw new Error("expected true");',
            },
            {
              name: 'rejects a non-palindrome',
              code: 'if (solution("race a car") !== false) throw new Error("expected false");',
            },
            {
              name: 'treats a blank string as a palindrome',
              code: 'if (solution(" ") !== true) throw new Error("expected true");',
            },
            {
              name: 'handles digits',
              code: 'if (solution("0P") !== false) throw new Error("expected false");',
            },
            {
              name: 'handles a long alternating string',
              hidden: true,
              code: 'const s = "ab".repeat(20000); if (solution(s) !== false) throw new Error("expected false"); const p = "a".repeat(40000); if (solution(p) !== true) throw new Error("expected true");',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 5
    {
      slug: 'sliding-window',
      name: 'Sliding window',
      description:
        'A contiguous range that grows at the right and shrinks at the left, so ' +
        'every element is visited a bounded number of times.',
      difficulty: 3,
      prerequisites: [{ slug: 'two-pointers', strength: 'HARD' }],
      learningObjectives: [
        'Tell a fixed-size window from a variable one and pick the right shape',
        'Maintain the window state incrementally instead of recomputing it',
        'Explain why the total work is O(n) even though there are two nested-looking loops',
      ],
      codingPatterns: [
        'Expand right unconditionally; shrink left while the window is invalid',
        'Keep a running aggregate updated on both entry and exit',
      ],
      commonMistakes: [
        'Recomputing the sum of the window each step, making it O(n·k)',
        'Forgetting to undo the left element state when shrinking',
        'Recording the answer outside the loop, after the window has already moved past it',
      ],
      questions: [
        {
          prompt:
            'A sliding-window loop has a `for` over right containing a `while` that advances left. Why is it O(n) and not O(n²)?',
          options: [
            'Because the while loop usually runs zero times',
            'Because left only ever moves forward, so across the whole run it advances at most n times in total',
            'Because the array is sorted',
            'It is O(n²); the shape is just conventional',
          ],
          correctIndex: 1,
          explanation:
            'Amortised analysis. Each index is entered once by right and left once by left, so the total pointer movement is bounded by 2n regardless of how the work is distributed across iterations.',
          difficulty: 3,
        },
        {
          prompt:
            'When shrinking a window from the left, what must happen besides incrementing the left index?',
          options: [
            'Nothing else',
            'The state that element contributed must be removed from the running aggregate',
            'The right pointer must also move',
            'The window must be recomputed from scratch',
          ],
          correctIndex: 1,
          explanation:
            'The aggregate describes the window. Advancing left without subtracting that element leaves the aggregate describing a window that no longer exists — the most common sliding-window bug.',
          difficulty: 2,
        },
      ],
      exercises: [
        {
          slug: 'dsa-longest-unique-substring',
          title: 'Longest substring without repeating characters',
          kind: 'CODING',
          difficulty: 3,
          objective:
            'Write `longestUnique(text)` returning the length of the longest contiguous substring containing no repeated character. Solve it in a single pass — O(n) time.',
          requirements: 'Return a length, not the substring. An empty string has length 0.',
          functionSignature: 'function longestUnique(text) { }',
          examples: [
            'longestUnique("abcabcbb") // 3  — "abc"',
            'longestUnique("bbbbb") // 1',
            'longestUnique("pwwkew") // 3  — "wke"',
          ],
          staticHints: [
            'When you meet a character already inside the window, what is the smallest amount you can shrink by and still be valid?',
            'What do you need to store to answer "where did I last see this character?" in O(1)?',
            'Is the best answer necessarily the final window?',
          ],
          estimatedMinutes: 20,
          testCases: [
            {
              name: 'finds abc',
              code: 'if (solution("abcabcbb") !== 3) throw new Error("expected 3");',
            },
            {
              name: 'handles all-identical characters',
              code: 'if (solution("bbbbb") !== 1) throw new Error("expected 1");',
            },
            {
              name: 'does not carry a stale left pointer',
              code: 'if (solution("pwwkew") !== 3) throw new Error("expected 3");',
            },
            {
              name: 'handles an empty string',
              code: 'if (solution("") !== 0) throw new Error("expected 0");',
            },
            {
              name: 'is linear on a large input',
              hidden: true,
              code: 'const s = "abcdefghij".repeat(20000); const started = Date.now(); if (solution(s) !== 10) throw new Error("expected 10"); if (Date.now() - started > 2000) throw new Error("too slow");',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 6
    {
      slug: 'binary-search',
      name: 'Binary search',
      description:
        'Halving a sorted search space. Easy to describe, and the boundary ' +
        'conditions are wrong in most first attempts.',
      difficulty: 3,
      prerequisites: [{ slug: 'complexity-analysis', strength: 'SOFT' }],
      learningObjectives: [
        'Write the loop without an off-by-one or an infinite loop',
        'Search on an answer space, not only on an array',
        'Find a boundary — first true — rather than an exact match',
      ],
      codingPatterns: [
        'while (low <= high) with mid = low + ((high - low) >> 1)',
        'Boundary search: keep the candidate, move high to mid - 1',
      ],
      commonMistakes: [
        'Computing mid as (low + high) / 2 and overflowing in languages with fixed-width ints',
        'Using low < high with high = mid, then never terminating',
        'Returning as soon as any match is found when the first match was required',
      ],
      questions: [
        {
          prompt:
            'Why write `mid = low + Math.floor((high - low) / 2)` rather than `(low + high) / 2`?',
          options: [
            'It is faster',
            'It avoids integer overflow when low and high are both large',
            'It gives a different midpoint',
            'It handles empty arrays',
          ],
          correctIndex: 1,
          explanation:
            'In a fixed-width integer language low + high can exceed the maximum and wrap negative. JavaScript numbers make this harmless in practice, but the habit is what an interviewer is checking for.',
          difficulty: 2,
        },
        {
          prompt:
            'Binary search over a sorted array of 1,000,000 elements takes at most about how many comparisons?',
          options: ['1,000', '20', '500,000', '1,000,000'],
          correctIndex: 1,
          explanation:
            'log2(1,000,000) is just under 20. Each comparison halves the remaining space, ' +
            'which is why it stays fast as data grows — a billion elements is only ten more steps.',
          difficulty: 1,
        },
      ],
      exercises: [
        {
          slug: 'dsa-search-insert-position',
          title: 'Search insert position',
          kind: 'CODING',
          difficulty: 2,
          objective:
            'Write `searchInsert(sorted, target)` returning the index of target in the sorted array, or the index where it should be inserted to keep the array sorted. Must run in O(log n).',
          requirements:
            'The input is sorted ascending with no duplicates. Return an index in the range 0..sorted.length.',
          functionSignature: 'function searchInsert(sorted, target) { }',
          examples: [
            'searchInsert([1, 3, 5, 6], 5) // 2',
            'searchInsert([1, 3, 5, 6], 2) // 1',
            'searchInsert([1, 3, 5, 6], 7) // 4',
          ],
          staticHints: [
            'When the loop ends without a match, what do low and high point at?',
            'Which of the two is the insertion point?',
            'Check the case where target is larger than everything — does your return still hold?',
          ],
          estimatedMinutes: 15,
          testCases: [
            {
              name: 'finds an existing value',
              code: 'if (solution([1,3,5,6], 5) !== 2) throw new Error("expected 2");',
            },
            {
              name: 'inserts in the middle',
              code: 'if (solution([1,3,5,6], 2) !== 1) throw new Error("expected 1");',
            },
            {
              name: 'inserts at the end',
              code: 'if (solution([1,3,5,6], 7) !== 4) throw new Error("expected 4");',
            },
            {
              name: 'inserts at the start',
              code: 'if (solution([1,3,5,6], 0) !== 0) throw new Error("expected 0");',
            },
            {
              name: 'handles an empty array',
              code: 'if (solution([], 1) !== 0) throw new Error("expected 0");',
            },
            {
              name: 'is logarithmic, not linear',
              hidden: true,
              code: 'const big = Array.from({length: 2000000}, (_, i) => i * 2); const started = Date.now(); if (solution(big, 3999998) !== 1999999) throw new Error("wrong index on large input"); if (Date.now() - started > 1000) throw new Error("too slow — this looks like a linear scan");',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 7
    {
      slug: 'stacks-and-queues',
      name: 'Stacks and queues',
      description:
        'Last-in-first-out and first-in-first-out, and recognising which one a ' +
        'problem is secretly describing.',
      difficulty: 2,
      prerequisites: [{ slug: 'arrays-and-strings', strength: 'SOFT' }],
      learningObjectives: [
        'Spot the matching/nesting shape that always means a stack',
        'Know why shift() on an array is O(n) and what to use instead',
        'Use a stack to undo, and a queue to process in arrival order',
      ],
      codingPatterns: [
        'Push on open, pop and compare on close',
        'Monotonic stack: pop while the incoming element breaks the invariant',
      ],
      commonMistakes: [
        'Popping an empty stack without checking, and comparing against undefined',
        'Finishing the loop without checking the stack is empty, so "(((" passes',
        'Using array.shift() in a hot loop and turning an O(n) algorithm into O(n²)',
      ],
      questions: [
        {
          prompt:
            'A bracket matcher pushes on every opener and pops on every closer. It reports "(((" as valid. What is missing?',
          options: [
            'It should pop on openers instead',
            'After the loop it must check the stack is empty',
            'It should use a queue',
            'It should compare characters case-insensitively',
          ],
          correctIndex: 1,
          explanation:
            'Every closer matched, because there were none. Leftover items on the stack are unclosed openers, so the emptiness check after the loop is part of the algorithm, not a tidy-up.',
          difficulty: 2,
        },
        {
          prompt: 'Why is `array.shift()` a poor way to dequeue in a performance-sensitive loop?',
          options: [
            'It returns the wrong end',
            'It reindexes every remaining element, so it is O(n) per call',
            'It mutates the array',
            'It cannot handle objects',
          ],
          correctIndex: 1,
          explanation:
            'Removing the front of a contiguous array shifts everything down. Doing it n times is O(n²). A head index into the array, or a linked structure, keeps dequeue O(1).',
          difficulty: 3,
        },
      ],
      exercises: [
        {
          slug: 'dsa-valid-parentheses',
          title: 'Valid parentheses',
          kind: 'CODING',
          difficulty: 2,
          objective:
            'Write `isValid(text)` returning true if every bracket in the string is closed by the matching type in the correct order. The string contains only the characters ()[]{}.',
          requirements:
            'An empty string is valid. Brackets must close in the reverse of the order they opened.',
          functionSignature: 'function isValid(text) { }',
          examples: [
            'isValid("()[]{}") // true',
            'isValid("([)]") // false',
            'isValid("{[]}") // true',
          ],
          staticHints: [
            'When you meet a closing bracket, which opening bracket must it match — the first one you saw, or the most recent?',
            'What does a leftover opener at the end mean?',
            'What should happen if a closer arrives and nothing is open?',
          ],
          estimatedMinutes: 15,
          testCases: [
            {
              name: 'accepts simple pairs',
              code: 'if (solution("()[]{}") !== true) throw new Error("expected true");',
            },
            {
              name: 'rejects interleaved brackets',
              code: 'if (solution("([)]") !== false) throw new Error("expected false");',
            },
            {
              name: 'accepts nesting',
              code: 'if (solution("{[]}") !== true) throw new Error("expected true");',
            },
            {
              name: 'rejects unclosed openers',
              code: 'if (solution("(((") !== false) throw new Error("expected false");',
            },
            {
              name: 'rejects a closer with nothing open',
              code: 'if (solution(")") !== false) throw new Error("expected false");',
            },
            {
              name: 'accepts the empty string',
              code: 'if (solution("") !== true) throw new Error("expected true");',
            },
            {
              name: 'handles deep nesting without recursing',
              hidden: true,
              code: 'const deep = "(".repeat(50000) + ")".repeat(50000); if (solution(deep) !== true) throw new Error("expected true"); if (solution("(".repeat(50000)) !== false) throw new Error("expected false");',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 8
    {
      slug: 'linked-lists',
      name: 'Linked lists',
      description:
        'Pointer surgery. No random access, no length, and one lost reference ' +
        'loses the rest of the list.',
      difficulty: 3,
      prerequisites: [{ slug: 'arrays-and-strings', strength: 'SOFT' }],
      learningObjectives: [
        'Reverse a list iteratively without losing the tail',
        'Use a dummy head to avoid special-casing the first node',
        'Detect a cycle with fast and slow pointers',
      ],
      codingPatterns: [
        'prev / current / next, advancing all three each step',
        'Dummy head node so deleting the first element is not a special case',
      ],
      commonMistakes: [
        'Reassigning next before saving it, orphaning the rest of the list',
        'Dereferencing node.next.next without checking node.next',
        'Returning the old head after a reversal instead of the new one',
      ],
      questions: [
        {
          prompt:
            'Reversing a linked list iteratively, why must you store `next = current.next` before setting `current.next = prev`?',
          options: [
            'To keep the code readable',
            'Because overwriting current.next first loses the only reference to the rest of the list',
            'Because prev may be null',
            'To avoid a memory leak',
          ],
          correctIndex: 1,
          explanation:
            'A singly linked list has exactly one reference to each node. Overwrite it before saving and the remainder is unreachable — the classic way this is written wrong.',
          difficulty: 2,
        },
        {
          prompt: 'What does a dummy head node remove the need for?',
          options: [
            'Traversing the list',
            'Special-case code for operations that change the first node',
            'Checking for null',
            'Counting the length',
          ],
          correctIndex: 1,
          explanation:
            'With a dummy in front, every real node has a predecessor, so deleting or inserting at the head uses the same code as anywhere else. The answer is dummy.next.',
          difficulty: 2,
        },
      ],
      exercises: [
        {
          slug: 'dsa-reverse-linked-list',
          title: 'Reverse a linked list',
          kind: 'CODING',
          difficulty: 3,
          objective:
            'Write `reverseList(head)` that reverses a singly linked list and returns the new head. Each node is `{ value, next }`, with next being null at the end. Reverse it iteratively in O(n) time and O(1) extra space — do not build an array.',
          requirements:
            'Return the new head node. An empty list (null) reverses to null. Reuse the existing nodes rather than creating new ones.',
          functionSignature: 'function reverseList(head) { }',
          examples: [
            'reverseList({value:1, next:{value:2, next:null}}) // {value:2, next:{value:1, next:null}}',
            'reverseList(null) // null',
          ],
          staticHints: [
            'You need three references in flight at once. What are they?',
            'What should the original head point to when you are done?',
            'How do you know which node to return?',
          ],
          estimatedMinutes: 20,
          testCases: [
            {
              name: 'reverses a three-node list',
              code: [
                'const list = {value:1, next:{value:2, next:{value:3, next:null}}};',
                'let node = solution(list);',
                'const seen = [];',
                'while (node) { seen.push(node.value); node = node.next; }',
                'if (JSON.stringify(seen) !== JSON.stringify([3,2,1])) throw new Error("got " + JSON.stringify(seen));',
              ].join('\n'),
            },
            {
              name: 'reverses a single node',
              code: 'const r = solution({value:7, next:null}); if (r.value !== 7 || r.next !== null) throw new Error("single node should be unchanged");',
            },
            {
              name: 'handles an empty list',
              code: 'if (solution(null) !== null) throw new Error("expected null");',
            },
            {
              name: 'terminates the new tail',
              hidden: true,
              code: [
                'const list = {value:1, next:{value:2, next:null}};',
                'const head = solution(list);',
                'if (head.next.next !== null) throw new Error("the old head must now point at null");',
              ].join('\n'),
            },
            {
              name: 'reuses nodes rather than allocating',
              hidden: true,
              code: [
                'const tail = {value:2, next:null};',
                'const list = {value:1, next:tail};',
                'const head = solution(list);',
                'if (head !== tail) throw new Error("must return the existing last node, not a copy");',
              ].join('\n'),
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 9
    {
      slug: 'recursion-and-backtracking',
      name: 'Recursion and backtracking',
      description:
        'Solving a problem in terms of itself, and undoing a choice so the next ' +
        'one starts clean.',
      difficulty: 4,
      prerequisites: [{ slug: 'stacks-and-queues', strength: 'SOFT' }],
      learningObjectives: [
        'Write a base case that actually terminates every branch',
        'Undo state after a recursive call so siblings are unaffected',
        'Estimate the cost of a branching search',
      ],
      codingPatterns: [
        'choose, recurse, un-choose',
        'Pass an accumulator down rather than returning and merging',
      ],
      commonMistakes: [
        'A base case that misses one branch, so some paths never terminate',
        'Pushing the shared accumulator into the results without copying it',
        'Forgetting to undo the choice, so later branches inherit earlier state',
      ],
      questions: [
        {
          prompt:
            'A backtracking function collects results with `results.push(path)`. Every result comes out empty. Why?',
          options: [
            'push is asynchronous',
            'path is the same array being mutated — every entry references it, and it is empty at the end',
            'The base case is wrong',
            'results should be a Set',
          ],
          correctIndex: 1,
          explanation:
            'Pushing the reference stores the live array, not its contents at that moment. By the time you read results, backtracking has popped everything back off. `results.push([...path])` is the fix.',
          difficulty: 3,
        },
        {
          prompt: 'What does the "un-choose" step in choose/recurse/un-choose exist for?',
          options: [
            'To free memory',
            'To restore the shared state so the next sibling branch explores from the same starting point',
            'To make the function pure',
            'To stop infinite recursion',
          ],
          correctIndex: 1,
          explanation:
            'The state is shared across the whole search. Without undoing the choice, the second branch starts from wherever the first one finished and explores something that is not a valid path.',
          difficulty: 3,
        },
      ],
      exercises: [
        {
          slug: 'dsa-subsets',
          title: 'All subsets',
          kind: 'CODING',
          difficulty: 4,
          objective:
            'Write `subsets(numbers)` returning every possible subset of the input array, including the empty subset and the full array. The input has no duplicates. Order of the subsets does not matter, but each subset must keep the input order.',
          requirements:
            'Return an array of arrays. There are exactly 2^n subsets for n inputs. Each subset must be its own array, not a shared reference.',
          functionSignature: 'function subsets(numbers) { }',
          examples: ['subsets([1,2]) // [[], [1], [2], [1,2]] in any order', 'subsets([]) // [[]]'],
          staticHints: [
            'For each element there are exactly two choices. What are they?',
            'What does the accumulator hold when you reach the end of the input?',
            'If you push the accumulator itself, what happens to it afterwards?',
          ],
          estimatedMinutes: 25,
          testCases: [
            {
              name: 'produces all four subsets of two elements',
              code: [
                'const out = solution([1,2]).map(s => JSON.stringify(s)).sort();',
                'const want = [[],[1],[2],[1,2]].map(s => JSON.stringify(s)).sort();',
                'if (JSON.stringify(out) !== JSON.stringify(want)) throw new Error("got " + JSON.stringify(out));',
              ].join('\n'),
            },
            {
              name: 'returns the empty subset for an empty input',
              code: 'const out = solution([]); if (JSON.stringify(out) !== JSON.stringify([[]])) throw new Error("got " + JSON.stringify(out));',
            },
            {
              name: 'produces 2^n subsets',
              code: 'if (solution([1,2,3,4]).length !== 16) throw new Error("expected 16 subsets");',
            },
            {
              name: 'each subset is a distinct array',
              hidden: true,
              code: [
                'const out = solution([1,2,3]);',
                'const ids = new Set(out);',
                'if (ids.size !== out.length) throw new Error("subsets share an array reference — copy before collecting");',
                'const sizes = out.map(s => s.length).sort();',
                'if (JSON.stringify(sizes) !== JSON.stringify([0,1,1,1,2,2,2,3])) throw new Error("wrong subset sizes: " + JSON.stringify(sizes));',
              ].join('\n'),
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 10
    {
      slug: 'trees',
      name: 'Binary trees',
      description:
        'Recursive structure, recursive solution. Traversal order is usually the ' +
        'whole answer.',
      difficulty: 4,
      prerequisites: [{ slug: 'recursion-and-backtracking', strength: 'HARD' }],
      learningObjectives: [
        'Write pre-order, in-order and post-order traversals and say what each is for',
        'Use the binary-search-tree invariant to skip half the tree',
        'Compute depth and validate structure recursively',
      ],
      codingPatterns: [
        'Recurse left, handle node, recurse right',
        'Return a value up the call stack rather than mutating an outer variable',
      ],
      commonMistakes: [
        'Validating a BST by comparing only against the immediate parent instead of a range',
        'Forgetting the null base case and dereferencing null',
        'Confusing depth with height, and off-by-one on both',
      ],
      questions: [
        {
          prompt: 'Which traversal of a binary *search* tree visits the values in ascending order?',
          options: ['Pre-order', 'In-order', 'Post-order', 'Level-order'],
          correctIndex: 1,
          explanation:
            'In-order is left, node, right. Combined with the BST invariant — everything left is smaller, everything right is larger — that visits values in sorted order. It is the standard way to prove a tree is a valid BST.',
          difficulty: 2,
        },
        {
          prompt:
            'Validating a BST by checking only that each node is greater than its left child and less than its right child accepts invalid trees. Why?',
          options: [
            'Because it does not handle duplicates',
            'Because the invariant applies to entire subtrees, not just immediate children',
            'Because it does not check for null',
            'It does not — that check is sufficient',
          ],
          correctIndex: 1,
          explanation:
            'A node deep in the left subtree can still be larger than the root and pass every parent-child check. Each node must be inside a min/max range narrowed on the way down.',
          difficulty: 4,
        },
      ],
      exercises: [
        {
          slug: 'dsa-max-depth',
          title: 'Maximum depth of a binary tree',
          kind: 'CODING',
          difficulty: 3,
          objective:
            'Write `maxDepth(root)` returning the number of nodes along the longest path from the root down to a leaf. A node is `{ value, left, right }` with null for missing children. An empty tree has depth 0.',
          requirements: 'Return a number. A single node has depth 1.',
          functionSignature: 'function maxDepth(root) { }',
          examples: [
            'maxDepth(null) // 0',
            'maxDepth({value:1, left:null, right:null}) // 1',
            'maxDepth({value:1, left:{value:2, left:null, right:null}, right:null}) // 2',
          ],
          staticHints: [
            'If you knew the depth of both subtrees, what would the answer be?',
            'What is the depth of an empty tree, and why does that make a good base case?',
            'Does this need any state outside the function?',
          ],
          estimatedMinutes: 15,
          testCases: [
            {
              name: 'empty tree has depth 0',
              code: 'if (solution(null) !== 0) throw new Error("expected 0");',
            },
            {
              name: 'single node has depth 1',
              code: 'if (solution({value:1, left:null, right:null}) !== 1) throw new Error("expected 1");',
            },
            {
              name: 'takes the deeper of two subtrees',
              code: [
                'const tree = {value:3, left:{value:9,left:null,right:null}, right:{value:20, left:{value:15,left:null,right:null}, right:{value:7,left:null,right:null}}};',
                'if (solution(tree) !== 3) throw new Error("expected 3");',
              ].join('\n'),
            },
            {
              name: 'handles a left-leaning chain',
              hidden: true,
              code: [
                'let node = null;',
                'for (let i = 0; i < 500; i += 1) node = {value: i, left: node, right: null};',
                'if (solution(node) !== 500) throw new Error("expected 500");',
              ].join('\n'),
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 11
    {
      slug: 'graphs',
      name: 'Graphs, BFS and DFS',
      description:
        'Nodes and edges, and the two ways to walk them. BFS is a queue, DFS is ' +
        'a stack — everything else is bookkeeping.',
      difficulty: 4,
      prerequisites: [
        { slug: 'trees', strength: 'HARD' },
        { slug: 'stacks-and-queues', strength: 'HARD' },
      ],
      learningObjectives: [
        'Choose BFS for shortest path in an unweighted graph, DFS for reachability',
        'Track visited nodes and explain what happens without it',
        'Represent a graph as an adjacency list and say why not a matrix',
      ],
      codingPatterns: [
        'BFS: queue plus a visited set, marking on enqueue',
        'DFS: recursion plus a visited set, marking on entry',
      ],
      commonMistakes: [
        'Marking visited on dequeue instead of enqueue, so a node enters the queue many times',
        'Omitting the visited set entirely and looping forever on a cycle',
        'Using DFS for shortest path and getting a path that happens to be longer',
      ],
      questions: [
        {
          prompt:
            'Why should BFS mark a node visited when it is *enqueued* rather than when it is dequeued?',
          options: [
            'It makes the code shorter',
            'Otherwise the same node can be enqueued several times before it is first processed',
            'Dequeuing is slower',
            'It changes the traversal order',
          ],
          correctIndex: 1,
          explanation:
            'Between enqueue and dequeue, several other nodes may see the same neighbour and enqueue it again. Marking on enqueue keeps the queue bounded by the number of nodes.',
          difficulty: 3,
        },
        {
          prompt:
            'You need the shortest path between two nodes in an unweighted graph. BFS or DFS?',
          options: [
            'DFS, because it goes deep quickly',
            'BFS, because it reaches every node at distance k before any at distance k+1',
            'Either gives the same answer',
            'Neither — shortest path needs Dijkstra',
          ],
          correctIndex: 1,
          explanation:
            'BFS explores in order of distance, so the first time it reaches the target it has done so by a shortest path. DFS finds *a* path. Dijkstra is for weighted edges, where BFS no longer holds.',
          difficulty: 3,
        },
      ],
      exercises: [
        {
          slug: 'dsa-count-islands',
          title: 'Count islands in a grid',
          kind: 'CODING',
          difficulty: 4,
          objective:
            'Write `countIslands(grid)` where grid is a 2D array of 0s and 1s. Return the number of islands — groups of 1s connected horizontally or vertically. Diagonals do not connect.',
          requirements:
            'An empty grid has 0 islands. You may modify the grid. Only up, down, left and right count as adjacent.',
          functionSignature: 'function countIslands(grid) { }',
          examples: [
            'countIslands([[1,1,0],[0,1,0],[0,0,1]]) // 2',
            'countIslands([[0,0],[0,0]]) // 0',
          ],
          staticHints: [
            'When you find a 1 you have not seen, how many islands does that add — and what must you do to the rest of it?',
            'How do you stop counting the same island twice without a separate visited structure?',
            'What stops the walk running off the edge of the grid?',
          ],
          estimatedMinutes: 25,
          testCases: [
            {
              name: 'counts two separate islands',
              code: 'if (solution([[1,1,0],[0,1,0],[0,0,1]]) !== 2) throw new Error("expected 2");',
            },
            {
              name: 'counts nothing in an empty sea',
              code: 'if (solution([[0,0],[0,0]]) !== 0) throw new Error("expected 0");',
            },
            {
              name: 'treats the whole grid as one island',
              code: 'if (solution([[1,1],[1,1]]) !== 1) throw new Error("expected 1");',
            },
            {
              name: 'does not connect diagonals',
              code: 'if (solution([[1,0],[0,1]]) !== 2) throw new Error("diagonal cells are separate islands");',
            },
            {
              name: 'handles an empty grid',
              code: 'if (solution([]) !== 0) throw new Error("expected 0");',
            },
            {
              name: 'handles a large grid without blowing up',
              hidden: true,
              code: [
                'const grid = Array.from({length: 120}, (_, r) => Array.from({length: 120}, (_, c) => (r % 2 === 0 && c % 2 === 0) ? 1 : 0));',
                'if (solution(grid) !== 3600) throw new Error("expected 3600 single-cell islands");',
              ].join('\n'),
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------- 12
    {
      slug: 'dynamic-programming',
      name: 'Dynamic programming',
      description:
        'Recursion with the repeated work removed. Find the state, find the ' +
        'transition, and the rest is bookkeeping.',
      difficulty: 5,
      prerequisites: [{ slug: 'recursion-and-backtracking', strength: 'HARD' }],
      learningObjectives: [
        'Identify overlapping subproblems and optimal substructure',
        'Convert a recursive solution to a memoised one, then to a bottom-up table',
        'Reduce the table to O(1) space when only the last few states are needed',
      ],
      codingPatterns: [
        'Define state as the smallest thing that makes the future independent of the past',
        'Bottom-up: fill a table in dependency order',
        'Rolling variables when the transition only looks back a fixed distance',
      ],
      commonMistakes: [
        'Choosing a state that does not capture everything the future depends on',
        'Memoising on a mutable key, so two different states share a cache entry',
        'Filling the table in an order where a cell reads a neighbour that is not computed yet',
      ],
      questions: [
        {
          prompt:
            'What distinguishes a problem that dynamic programming helps with from one that plain recursion handles fine?',
          options: [
            'The input is larger',
            'The recursion recomputes the same subproblems many times',
            'It involves arrays',
            'It has a base case',
          ],
          correctIndex: 1,
          explanation:
            'Overlapping subproblems is the whole justification. Merge sort recurses heavily and gains nothing from memoisation, because its subproblems are all distinct.',
          difficulty: 3,
        },
        {
          prompt:
            'Computing fib(n) bottom-up, why can the whole table be replaced by two variables?',
          options: [
            'Because the values are small',
            'Because the transition only reads the previous two states, so older ones are dead',
            'Because addition is commutative',
            'It cannot — the table is required',
          ],
          correctIndex: 1,
          explanation:
            'Space can always be cut to the width of the transition window. fib looks back exactly two, so two variables suffice and the table drops from O(n) to O(1).',
          difficulty: 3,
        },
      ],
      exercises: [
        {
          slug: 'dsa-climbing-stairs',
          title: 'Climbing stairs',
          kind: 'CODING',
          difficulty: 3,
          objective:
            'Write `climbStairs(n)` returning how many distinct ways there are to climb n steps taking either 1 or 2 steps at a time. Must run in O(n) time and O(1) extra space — a naive recursion will time out.',
          requirements:
            'n is a non-negative integer. There is exactly 1 way to climb 0 steps: take nothing.',
          functionSignature: 'function climbStairs(n) { }',
          examples: ['climbStairs(2) // 2  — 1+1, or 2', 'climbStairs(3) // 3  — 1+1+1, 1+2, 2+1'],
          staticHints: [
            'What was the last step you took to arrive at step n? There are only two possibilities.',
            'How many ways are there to reach each of those two places?',
            'Do you need the whole table, or only the last two values?',
          ],
          estimatedMinutes: 18,
          testCases: [
            {
              name: 'two steps has two ways',
              code: 'if (solution(2) !== 2) throw new Error("expected 2");',
            },
            {
              name: 'three steps has three ways',
              code: 'if (solution(3) !== 3) throw new Error("expected 3");',
            },
            {
              name: 'one step has one way',
              code: 'if (solution(1) !== 1) throw new Error("expected 1");',
            },
            {
              name: 'zero steps has one way',
              code: 'if (solution(0) !== 1) throw new Error("expected 1 — taking nothing is a way");',
            },
            {
              name: 'is linear, not exponential',
              hidden: true,
              code: [
                'const started = Date.now();',
                'if (solution(40) !== 165580141) throw new Error("wrong answer for 40");',
                'if (Date.now() - started > 1000) throw new Error("too slow — this is the naive recursion");',
              ].join('\n'),
            },
          ],
        },
      ],
    },
  ],
};
