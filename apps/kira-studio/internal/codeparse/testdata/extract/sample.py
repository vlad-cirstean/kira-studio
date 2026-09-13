class Greeter:
    def greet(self, name):
        return helper(name)


def helper(name):
    return "hi " + name


class Robot(Greeter):
    def greet(self, name):
        return helper(name)
