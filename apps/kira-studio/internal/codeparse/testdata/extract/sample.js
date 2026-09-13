class Greeter {
  greet(name) {
    return helper(name);
  }
}

function helper(name) {
  return "hi " + name;
}

class Robot extends Greeter {
  build() {
    return new Greeter();
  }
}
