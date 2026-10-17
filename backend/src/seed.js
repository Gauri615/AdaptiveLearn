import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';
dotenv.config();

async function seed() {
  try {
    await pool.query('SELECT 1');
    const usersSeed = [
      { name: 'Alex Morgan', email: 'student@adaptix.dev', password: 'Student@123', role: 'student' },
      { name: 'Jordan Lee', email: 'student2@adaptix.dev', password: 'Student2@123', role: 'student' },
      { name: 'Taylor Smith', email: 'trainer@adaptix.dev', password: 'Trainer@123', role: 'trainer' }
    ];
    const userIds = {};
    for (const u of usersSeed) {
      let rows = await query('SELECT id FROM users WHERE email=?', [u.email]);
      if (!rows.length) {
        const hash = await bcrypt.hash(u.password, 12);
        const ins = await query('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)', [u.name, u.email, hash, u.role]);
        userIds[u.email] = Number(ins.insertId);
      } else userIds[u.email] = Number(rows[0].id);
    }

    const concepts = [
      ['variables','Variables & Data Types','Understand primitive types, variables, assignment, and safe type conversion.','Java Foundations','Foundation',1,12],
      ['conditionals','Conditional Logic','Use if/else and boolean expressions to make decisions in a program.','Control Flow','Foundation',2,15],
      ['loops','Loops & Iteration','Repeat work with for and while loops, counters, and termination conditions.','Control Flow','Foundation',3,18],
      ['methods','Methods & Parameters','Break problems into methods, pass parameters, and return values.','Program Structure','Core',4,20],
      ['classes-objects','Classes & Objects','Model real-world entities using fields, methods, constructors, and instances.','Object-Oriented Programming','Core',5,25],
      ['constructors','Constructors','Initialize objects safely and understand constructor overloading.','Object-Oriented Programming','Core',6,18],
      ['inheritance','Inheritance','Reuse and specialize behaviour with parent and child classes.','Object-Oriented Programming','Core',7,24],
      ['polymorphism','Polymorphism','Understand overriding, dynamic dispatch, and substitutable behaviour.','Object-Oriented Programming','Advanced',8,25],
      ['exceptions','Exception Handling','Handle exceptional states using try/catch and meaningful exceptions.','Java Foundations','Core',9,18],
      ['collections','Collections Framework','Choose Lists, Sets, and Maps based on the problem requirements.','Java Foundations','Advanced',10,25],
      ['interfaces','Interfaces','Define contracts and separate implementation from behaviour.','Object-Oriented Programming','Advanced',11,20],
      ['dependency-injection','Dependency Injection','Supply collaborators from outside a class to reduce tight coupling.','Software Design','Advanced',12,30]
    ];
    for (const c of concepts) {
      await query(`INSERT INTO concepts (slug,title,description,category,level,order_index,estimated_minutes) VALUES (?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),category=VALUES(category),level=VALUES(level),order_index=VALUES(order_index),estimated_minutes=VALUES(estimated_minutes)`, c);
    }
    const cs = await query('SELECT id,slug FROM concepts');
    const cid = Object.fromEntries(cs.map(c => [c.slug, Number(c.id)]));
    const prereqs = [
      ['conditionals','variables'], ['loops','conditionals'], ['methods','variables'], ['methods','conditionals'],
      ['classes-objects','methods'], ['constructors','classes-objects'], ['inheritance','classes-objects'], ['inheritance','constructors'],
      ['polymorphism','inheritance'], ['exceptions','methods'], ['collections','classes-objects'], ['interfaces','classes-objects'],
      ['dependency-injection','interfaces'], ['dependency-injection','classes-objects']
    ];
    for (const [child,parent] of prereqs) await query('INSERT IGNORE INTO concept_prerequisites (concept_id,prerequisite_id) VALUES (?,?)', [cid[child], cid[parent]]);

    const questionCount = Number((await query('SELECT COUNT(*) n FROM diagnostic_questions'))[0].n);
    if (questionCount === 0) {
      const qs = [
        ['variables','conceptual','Which Java type is the most suitable for storing a whole number such as 42?',[['a','int'],['b','boolean'],['c','char'],['d','String']],'a','int stores whole-number values; boolean stores true/false.','Easy'],
        ['variables','application','Which statement declares an integer variable named count with value 3?',[['a','count int = 3;'],['b','int count = 3;'],['c','integer count = 3;'],['d','3 = int count;']],'b','Java puts the type before the variable name.','Easy'],
        ['conditionals','conceptual','What is the purpose of an if statement?',[['a','Repeat forever'],['b','Make a decision based on a condition'],['c','Create a class'],['d','Import a package']],'b','An if statement selects a branch based on a boolean condition.','Easy'],
        ['conditionals','output','What is printed by: int x=7; if(x>5) System.out.print("A"); else System.out.print("B");',[['a','A'],['b','B'],['c','AB'],['d','Nothing']],'a','7 > 5 is true, so the first branch prints A.','Easy'],
        ['loops','conceptual','What must eventually happen for a typical counting loop to terminate?',[['a','The condition becomes false'],['b','The class name changes'],['c','A method is deleted'],['d','A variable is a String']],'a','A loop normally terminates when its continuation condition becomes false.','Easy'],
        ['loops','debugging','Which issue can make a while loop run forever?',[['a','Condition is eventually false'],['b','Loop control state never changes so condition stays true'],['c','A comment is present'],['d','A method returns a value']],'b','If the condition never changes to false, the loop may not terminate.','Medium'],
        ['methods','conceptual','What does a return statement do in a non-void method?',[['a','Returns a value to the caller'],['b','Creates a database'],['c','Always repeats the method'],['d','Declares a package']],'a','A return statement passes the method result back to the caller.','Easy'],
        ['classes-objects','conceptual','In object-oriented programming, what is an object?',[['a','A running database'],['b','An instance of a class'],['c','A loop condition'],['d','A compiler warning']],'b','An object is an instance created from a class.','Easy'],
        ['constructors','conceptual','When is a Java constructor typically called?',[['a','When an object is created'],['b','Every time a loop repeats'],['c','Only after the program exits'],['d','When a comment is added']],'a','A constructor initializes a newly created object.','Medium'],
        ['inheritance','conceptual','Which keyword is used when a Java class inherits from another class?',[['a','implements'],['b','extends'],['c','inherits'],['d','superclass']],'b','The extends keyword defines class inheritance in Java.','Medium'],
        ['polymorphism','conceptual','Method overriding most directly supports which concept?',[['a','Polymorphism'],['b','Database normalization'],['c','Loop initialization'],['d','File compression']],'a','Overriding allows subtype-specific behavior through a shared interface.','Medium'],
        ['exceptions','conceptual','Which construct is commonly used to handle an exception?',[['a','try/catch'],['b','for/next'],['c','extends/return'],['d','SELECT/WHERE']],'a','try/catch lets code respond to an exception.','Easy'],
        ['collections','conceptual','Which Java collection naturally stores key-value pairs?',[['a','ArrayList'],['b','HashMap'],['c','HashSet'],['d','StringBuilder']],'b','HashMap maps unique keys to values.','Medium'],
        ['interfaces','conceptual','What does an interface primarily define?',[['a','A contract of behaviour'],['b','A private hard drive'],['c','A loop counter'],['d','An SQL table']],'a','An interface defines a contract implemented by classes.','Medium'],
        ['dependency-injection','conceptual','What is one benefit of dependency injection?',[['a','Tighter coupling'],['b','Reduced coupling and easier testing'],['c','All classes become static'],['d','It removes all methods']],'b','Injecting collaborators makes dependencies explicit and can simplify testing.','Hard']
      ];
      for (const q of qs) await query('INSERT INTO diagnostic_questions (concept_id,question_type,question_text,options_json,correct_answer,explanation,difficulty) VALUES (?,?,?,?,?,?,?)', [cid[q[0]], q[1], q[2], JSON.stringify(q[3].map(o => ({ value:o[0], label:o[1] }))), q[4], q[5], q[6]]);
    }

    const challengeCount = Number((await query('SELECT COUNT(*) n FROM coding_challenges'))[0].n);
    if (challengeCount === 0) {
      const challenges = [
        ['conditionals','Even or Odd Detector','Easy','Write a Java program that reads integers from standard input and prints true for even values and false for odd values.','public class Main {\n    // TODO: Implement isEven and read values from standard input\n}', ['public static boolean isEven','% 2','return true'], 'Use number % 2 == 0 and print one result for each input value.',15],
        ['loops','Sum from 1 to N','Easy','Write a method sumTo(int n) that returns the sum of all integers from 1 to n. Consider the boundary case n = 0.','public class Main {\n    public static int sumTo(int n) {\n        // TODO: Use a loop and return the sum\n        return 0;\n    }\n}', ['for (int','sum +=','return sum'], 'Use a running sum and a loop. Think about what the method should return when n is zero.',18],
        ['classes-objects','Bank Account Model','Medium','Create a small BankAccount class with a private balance, a constructor, a deposit method, and a getBalance method.','public class BankAccount {\n    private double balance;\n\n    public BankAccount(double initialBalance) {\n        // TODO: initialize balance\n    }\n\n    public void deposit(double amount) {\n        // TODO: update balance safely\n    }\n\n    public double getBalance() {\n        return balance;\n    }\n}', ['this.balance','balance += amount','amount > 0','return balance'], 'Use encapsulation and initialize state through the constructor. Consider rejecting non-positive deposits.',25],
        ['inheritance','Shape Inheritance','Medium','Create a base Shape class and a Circle subclass that overrides an area method.','class Shape {\n    public double area() { return 0; }\n}\n\nclass Circle extends Shape {\n    private double radius;\n    // TODO: add constructor and override area\n}', ['@Override','Math.PI','radius * radius','return'], 'Circle should specialize Shape and compute pi * radius * radius. Verify overriding and visibility.',25]
      ];
      for (const c of challenges) await query('INSERT INTO coding_challenges (concept_id,title,difficulty,prompt,starter_code,solution_keywords_json,solution_notes,estimated_minutes) VALUES (?,?,?,?,?,?,?,?)', [cid[c[0]], c[1], c[2], c[3], c[4], JSON.stringify(c[5]), c[6], c[7]]);
    }

    const executableChallenges = [
      {
        title: 'Even or Odd Detector',
        prompt: 'Read integers from standard input and print true for each even value and false for each odd value.',
        source: `import java.util.Scanner;
public class Main {
    public static boolean isEven(int number) {
        return false;
    }
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        while (input.hasNextInt()) System.out.println(isEven(input.nextInt()));
    }
}`,
        publicTests: [['8', 'true'], ['-3', 'false']],
        hiddenTests: [['0', 'true'], ['-12', 'true']]
      },
      {
        title: 'Sum from 1 to N',
        prompt: 'Read one integer n and print the sum from 1 through n. Return 0 when n is 0 or negative.',
        source: `import java.util.Scanner;
public class Main {
    public static int sumTo(int n) {
        return 0;
    }
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        if (input.hasNextInt()) System.out.println(sumTo(input.nextInt()));
    }
}`,
        publicTests: [['5', '15'], ['0', '0']],
        hiddenTests: [['1', '1'], ['100', '5050']]
      },
      {
        title: 'Bank Account Model',
        prompt: 'Read an initial balance and a deposit amount. Accept only positive deposits and print the resulting balance with two decimal places.',
        source: `import java.util.Locale;
import java.util.Scanner;
class BankAccount {
    private double balance;
    public BankAccount(double initialBalance) { balance = initialBalance; }
    public void deposit(double amount) { }
    public double getBalance() { return balance; }
}
public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        BankAccount account = new BankAccount(input.nextDouble());
        account.deposit(input.nextDouble());
        System.out.printf(Locale.ROOT, "%.2f%n", account.getBalance());
    }
}`,
        publicTests: [['100 25', '125.00'], ['100 -20', '100.00']],
        hiddenTests: [['0 10', '10.00'], ['50 0', '50.00']]
      },
      {
        title: 'Shape Inheritance',
        prompt: 'Create Shape and Circle classes with an overridden area method. Read a radius and print the circle area with two decimal places.',
        source: `import java.util.Locale;
import java.util.Scanner;
class Shape {
    public double area() { return 0; }
}
class Circle extends Shape {
    private final double radius;
    Circle(double radius) { this.radius = radius; }
    @Override public double area() { return Math.PI * radius * radius; }
}
public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        double radius = input.nextDouble();
        System.out.printf(Locale.ROOT, "%.2f%n", new Circle(radius).area());
    }
}`,
        publicTests: [['1', '3.14'], ['2', '12.57']],
        hiddenTests: [['0', '0.00'], ['3.5', '38.48']]
      }
    ];
    for (const exercise of executableChallenges) {
      const matches = await query('SELECT id FROM coding_challenges WHERE owner_id IS NULL AND title=? ORDER BY id LIMIT 1', [exercise.title]);
      if (!matches.length) continue;
      const challengeId = Number(matches[0].id);
      const caseCount = Number((await query('SELECT COUNT(*) n FROM coding_test_cases WHERE challenge_id=?', [challengeId]))[0].n);
      if (caseCount > 0) continue;
      await query('UPDATE coding_challenges SET starter_code=?,prompt=? WHERE id=? AND owner_id IS NULL', [exercise.source, exercise.prompt, challengeId]);
      for (const [input, expected] of exercise.publicTests) {
        await query('INSERT INTO coding_test_cases (challenge_id,visibility,input_data,expected_output,comparison_rule) VALUES (?,?,?,?,\'trim\')', [challengeId, 'public', input, expected]);
      }
      for (const [input, expected] of exercise.hiddenTests) {
        await query('INSERT INTO coding_test_cases (challenge_id,visibility,input_data,expected_output,comparison_rule) VALUES (?,?,?,?,\'trim\')', [challengeId, 'hidden', input, expected]);
      }
      await query('INSERT IGNORE INTO coding_challenge_concepts (challenge_id,concept_id,relation_type) VALUES (?,?,\'tag\')', [challengeId, (await query('SELECT concept_id FROM coding_challenges WHERE id=?', [challengeId]))[0].concept_id]);
    }

    for (const email of ['student@adaptix.dev','student2@adaptix.dev']) {
      const uid = userIds[email];
      for (const c of cs) await query('INSERT IGNORE INTO student_concept_mastery (user_id,concept_id,mastery_score,attempts,correct_count,last_evidence) VALUES (?,?,0,0,0,\'not_assessed\')', [uid, c.id]);
    }
    // Seed distinct, synthetic learning profiles so the prototype can show different recommendations immediately.
    const a = userIds['student@adaptix.dev']; const b = userIds['student2@adaptix.dev'];
    const profileA = { variables:82, conditionals:76, loops:52, methods:35, 'classes-objects':28, constructors:0, inheritance:0, polymorphism:0, exceptions:0, collections:0, interfaces:0, 'dependency-injection':0 };
    const profileB = { variables:88, conditionals:84, loops:91, methods:86, 'classes-objects':79, constructors:74, inheritance:68, polymorphism:48, exceptions:62, collections:57, interfaces:55, 'dependency-injection':0 };
    for (const [slug, score] of Object.entries(profileA)) if (cid[slug]) await query(`UPDATE student_concept_mastery SET mastery_score=?,attempts=?,correct_count=?,last_evidence='synthetic_demo_profile' WHERE user_id=? AND concept_id=?`, [score, score ? 3 : 0, score ? Math.round(score*3/100) : 0, a, cid[slug]]);
    for (const [slug, score] of Object.entries(profileB)) if (cid[slug]) await query(`UPDATE student_concept_mastery SET mastery_score=?,attempts=?,correct_count=?,last_evidence='synthetic_demo_profile' WHERE user_id=? AND concept_id=?`, [score, score ? 3 : 0, score ? Math.round(score*3/100) : 0, b, cid[slug]]);

    // A safe seed submission gives the Viva flow something to start from; its score is explicitly prototype-only.
    const existingSubmission = await query('SELECT id FROM code_submissions WHERE user_id=? LIMIT 1', [a]);
    if (!existingSubmission.length) {
      const challenge = (await query('SELECT id,starter_code FROM coding_challenges ORDER BY id LIMIT 1'))[0];
      await query('INSERT INTO code_submissions (user_id,challenge_id,source_code,status,score,feedback) VALUES (?,?,?,\'needs_work\',35,?)', [a, challenge.id, challenge.starter_code, 'Synthetic demo submission for demonstrating the review workflow. This score is sample data, not a real code execution result.']);
    }
    const existingBSubmission = await query('SELECT id FROM code_submissions WHERE user_id=? LIMIT 1', [b]);
    if (!existingBSubmission.length) {
      const challenge = (await query('SELECT id,starter_code FROM coding_challenges ORDER BY id DESC LIMIT 1'))[0];
      await query('INSERT INTO code_submissions (user_id,challenge_id,source_code,status,score,feedback) VALUES (?,?,?,\'needs_work\',45,?)', [b, challenge.id, challenge.starter_code, 'Synthetic demo submission for illustrating a second learner profile. This score is sample data, not a real code execution result.']);
    }
    const existingSignal = await query("SELECT id FROM integrity_review_signals WHERE signal_type='demo_context_signal' LIMIT 1");
    if (!existingSignal.length) {
      const ownSubmission = (await query('SELECT id,challenge_id FROM code_submissions WHERE user_id=? ORDER BY id LIMIT 1', [b]))[0];
      if (ownSubmission) await query('INSERT INTO integrity_review_signals (user_id,challenge_id,signal_type,explanation,event_ids_json) VALUES (?,?,?,?,?)', [b, ownSubmission.challenge_id, 'demo_context_signal', 'Synthetic demo example: reviewable context is shown here to demonstrate the trainer workflow. This is not evidence of misconduct, and no verdict is implied.', JSON.stringify([])]);
    }
    console.log('Seed completed. Demo accounts:');
    console.log('Student: student@adaptix.dev / Student@123');
    console.log('Student 2: student2@adaptix.dev / Student2@123');
    console.log('Trainer: trainer@adaptix.dev / Trainer@123');
  } catch (err) {
    console.error('Seed failed:', err.message);
    console.error('Import backend/sql/schema.sql into XAMPP MySQL before running the seed command.');
    process.exitCode = 1;
  } finally { await pool.end(); }
}
seed();
