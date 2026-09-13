interface Greeter {
  greet(name: string): string;
}

abstract class Person implements Greeter {
  abstract greet(name: string): string;
}

declare function helper(name: string): Greeter;

let g: Greeter;
