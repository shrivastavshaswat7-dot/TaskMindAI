// TEMPORARY: /api/quiz backend (B) ready hone tak sample data.
// Quiz page sirf tab use karta hai jab backend questions na de. Backend aate hi yeh file hata sakte hain.

export function mockQuestions(topicName) {
  return [
    {
      q: `Which approach works best when you revise ${topicName} before an exam?`,
      options: ['Re-reading notes only', 'Solving past-paper questions', 'Watching videos only', 'Skipping it'],
      answer: 'Solving past-paper questions',
      subtopic: 'Exam strategy',
    },
    {
      q: `For a high-mark ${topicName} question, what should you write first?`,
      options: ['The final answer', 'Given data and the formula/definition', 'A long introduction', 'Nothing, start calculating'],
      answer: 'Given data and the formula/definition',
      subtopic: 'Answer writing',
    },
    {
      q: `How do you check that a ${topicName} answer is correct?`,
      options: ['Assume it is right', 'Verify with a known case or units', 'Ask a friend later', 'Rewrite it neatly'],
      answer: 'Verify with a known case or units',
      subtopic: 'Verification',
    },
    {
      q: `Which ${topicName} items should go on a quick formula sheet?`,
      options: ['Everything in the textbook', 'Key formulas and standard results', 'Only examples', 'Only definitions'],
      answer: 'Key formulas and standard results',
      subtopic: 'Formulas',
    },
  ]
}

// Contract jaisa result: { score, total, weak_subtopics, updated_weakness }
export function mockSubmit(questions, answers, currentWeakness = 50) {
  const wrong = questions.filter((q, i) => answers[i] !== q.answer)
  const total = questions.length
  const score = total - wrong.length
  const quizWeakness = total > 0 ? 100 - Math.round((score / total) * 100) : currentWeakness
  return {
    score,
    total,
    weak_subtopics: [...new Set(wrong.map((q) => q.subtopic))],
    // Purani aur quiz wali weakness ka average, taaki ek quiz se ekdum jump na ho
    updated_weakness: Math.round((currentWeakness + quizWeakness) / 2),
  }
}
