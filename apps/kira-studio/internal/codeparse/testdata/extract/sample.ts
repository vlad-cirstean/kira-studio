interface Greeter {
  greet(name: string): string;
}

abstract class Person implements Greeter {
  abstract greet(name: string): string;
}

declare function helper(name: string): Greeter;

let g: Greeter;

class Robot implements Greeter {
  greet(name: string): string {
    return helper2(name);
  }
}

function helper2(name: string): string {
  return "hi " + name;
}
